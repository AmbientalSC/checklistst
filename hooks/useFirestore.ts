import { useState, useEffect, useCallback } from 'react';
import { where, orderBy } from 'firebase/firestore';
import { 
  User, 
  Unit, 
  ChecklistTemplate, 
  CompletedChecklist, 
  Notification, 
  AuditLogEntry,
  UserRole 
} from '../types.ts';
import {
  usersService,
  unitsService,
  templatesService,
  completedChecklistsService,
  notificationsService,
  auditLogService,
  getUserByEmail,
  getUsersByRole,
  getUnitsByManagerId,
  getNotificationsByUserId,
  getCompletedChecklistsByTechnician,
  getRecentAuditLogs
} from '../services/firestore.ts';
import { createUserWithPassword } from '../services/auth.ts';

// Generic hook for Firestore collections
function useFirestoreCollection<T>(service: any) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const unsubscribe = service.onSnapshot(
        (newData: T[]) => {
          setData(newData);
          setLoading(false);
        }
      );

      return unsubscribe;
    } catch (error: any) {
      console.error('Error setting up Firestore listener:', error);
      setError(error.message);
      setLoading(false);
      return () => {}; // Return empty cleanup function
    }
  }, [service]);

  const add = useCallback(async (item: Omit<T, 'id'>) => {
    try {
      const id = await service.add(item);
      return id;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }, [service]);

  const update = useCallback(async (id: string, item: Partial<T>) => {
    try {
      await service.update(id, item);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }, [service]);

  const remove = useCallback(async (id: string) => {
    try {
      await service.delete(id);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }, [service]);

  return { data, loading, error, add, update, remove };
}

// Hook for users
export function useUsers() {
  const { data: users, loading, error, add, update, remove } = useFirestoreCollection<User>(usersService);

  const getUserByEmailAddress = useCallback(async (email: string) => {
    try {
      return await getUserByEmail(email);
    } catch (err: any) {
      console.error('Error fetching user by email:', err);
      return null;
    }
  }, []);

  const getManagerUsers = useCallback(async () => {
    try {
      return await getUsersByRole(UserRole.MANAGER);
    } catch (err: any) {
      console.error('Error fetching managers:', err);
      return [];
    }
  }, []);

  const getTechnicianUsers = useCallback(async () => {
    try {
      return await getUsersByRole(UserRole.TECHNICIAN);
    } catch (err: any) {
      console.error('Error fetching technicians:', err);
      return [];
    }
  }, []);

  const createUser = useCallback(async (userData: Omit<User, 'id'> & { password?: string }) => {
    // If password provided, create Auth user first and store authUid
    try {
      if (userData.password) {
        const { localId } = await createUserWithPassword(userData.email, userData.password, userData.name);
        const { password, ...rest } = userData as any;
        const id = await add({ ...rest, authUid: localId });
        return id;
      }
      return await add(userData as any);
    } catch (err) {
      throw err;
    }
  }, [add]);

  return {
    users,
    loading,
    error,
    getUserByEmailAddress,
    getManagerUsers,
    getTechnicianUsers,
    createUser,
    updateUser: update,
    deleteUser: remove
  };
}

// Hook for units
export function useUnits() {
  const { data: units, loading, error, add, update, remove } = useFirestoreCollection<Unit>(unitsService);

  const getUnitsByManager = useCallback(async (managerId: string) => {
    try {
      return await getUnitsByManagerId(managerId);
    } catch (err: any) {
      console.error('Error fetching units by manager:', err);
      return [];
    }
  }, []);

  const createUnit = useCallback(async (unitData: Omit<Unit, 'id'>) => {
    return add(unitData);
  }, [add]);

  return {
    units,
    loading,
    error,
    getUnitsByManager,
    createUnit,
    updateUnit: update,
    deleteUnit: remove
  };
}

// Hook for templates
export function useTemplates() {
  const { data: templates, loading, error, add, update, remove } = useFirestoreCollection<ChecklistTemplate>(templatesService);

  const createTemplate = useCallback(async (templateData: Omit<ChecklistTemplate, 'id'>) => {
    return add(templateData);
  }, [add]);

  return {
    templates,
    loading,
    error,
    createTemplate,
    updateTemplate: update,
    deleteTemplate: remove
  };
}

// Hook for completed checklists
export function useCompletedChecklists() {
  const { data: completedChecklists, loading, error, add, update, remove } = useFirestoreCollection<CompletedChecklist>(completedChecklistsService);

  const getChecklistsByTechnician = useCallback(async (technicianId: string) => {
    try {
      return await getCompletedChecklistsByTechnician(technicianId);
    } catch (err: any) {
      console.error('Error fetching checklists by technician:', err);
      return [];
    }
  }, []);

  const submitChecklist = useCallback(async (checklistData: Omit<CompletedChecklist, 'id'>) => {
    return add(checklistData);
  }, [add]);

  return {
    completedChecklists,
    loading,
    error,
    getChecklistsByTechnician,
    submitChecklist,
    updateChecklist: update,
    deleteChecklist: remove
  };
}

// Hook for notifications
export function useNotifications(userId?: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    // Subscribe to notifications for the current user in real-time
    const constraints = [where('userId', '==', userId), orderBy('timestamp', 'desc')];
    const unsubscribe = notificationsService.onSnapshot(
      (userNotifications: Notification[]) => {
        setNotifications(userNotifications);
        setLoading(false);
      },
      constraints
    );

    return () => {
      try { unsubscribe(); } catch { /* ignore */ }
    };
  }, [userId]);

  const createNotification = useCallback(async (notificationData: Omit<Notification, 'id'>) => {
    try {
      const id = await notificationsService.add(notificationData);
      return id;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }, []);

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await notificationsService.update(notificationId, { read: true });
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }, []);

  return {
    notifications,
    loading,
    error,
    createNotification,
    markAsRead
  };
}

// Hook for audit log
export function useAuditLog() {
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAuditLog = async () => {
      try {
        const logs = await getRecentAuditLogs();
        setAuditLog(logs);
        setLoading(false);
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchAuditLog();
  }, []);

  const addAuditLog = useCallback(async (logData: Omit<AuditLogEntry, 'id'>) => {
    try {
      const id = await auditLogService.add(logData);
      return id;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }, []);

  return {
    auditLog,
    loading,
    error,
    addAuditLog
  };
}