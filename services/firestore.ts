import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  Timestamp,
  QueryConstraint,
  CollectionReference,
  DocumentReference
} from 'firebase/firestore';
import { db } from '../firebase.ts';
import { 
  User, 
  Unit, 
  ChecklistTemplate, 
  CompletedChecklist, 
  Notification, 
  AuditLogEntry 
} from '../types.ts';

// Collection names
export const COLLECTIONS = {
  USERS: 'users',
  UNITS: 'units',
  TEMPLATES: 'templates',
  COMPLETED_CHECKLISTS: 'completedChecklists',
  NOTIFICATIONS: 'notifications',
  AUDIT_LOG: 'auditLog'
} as const;

// Generic Firestore operations
export class FirestoreService<T> {
  private collectionRef: CollectionReference;

  constructor(collectionName: string) {
    this.collectionRef = collection(db, collectionName);
  }

  // Get all documents
  async getAll(constraints: QueryConstraint[] = []): Promise<T[]> {
    const q = constraints.length > 0 ? query(this.collectionRef, ...constraints) : this.collectionRef;
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as T[];
  }

  // Get document by ID
  async getById(id: string): Promise<T | null> {
    const docRef = doc(this.collectionRef, id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as T;
    }
    return null;
  }

  // Add document
  async add(data: Omit<T, 'id'>): Promise<string> {
    // Remove undefined fields to avoid Firestore errors
    const payload: any = {};
    Object.entries(data as any).forEach(([k, v]) => {
      if (v !== undefined) payload[k] = v;
    });
    payload.createdAt = Timestamp.now();
    payload.updatedAt = Timestamp.now();
    const docRef = await addDoc(this.collectionRef, payload);
    return docRef.id;
  }

  // Update document
  async update(id: string, data: Partial<T>): Promise<void> {
    const docRef = doc(this.collectionRef, id);
    const payload: any = {};
    Object.entries(data as any).forEach(([k, v]) => {
      if (v !== undefined) payload[k] = v;
    });
    payload.updatedAt = Timestamp.now();
    await updateDoc(docRef, payload);
  }

  // Delete document
  async delete(id: string): Promise<void> {
    const docRef = doc(this.collectionRef, id);
    await deleteDoc(docRef);
  }

  // Real-time listener
  onSnapshot(
    callback: (data: T[]) => void,
    constraints: QueryConstraint[] = []
  ): () => void {
    const q = constraints.length > 0 ? query(this.collectionRef, ...constraints) : this.collectionRef;
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as T[];
      callback(data);
    }, (error) => {
      console.error('Firestore onSnapshot error:', error);
    });
  }

  // Query with constraints
  async query(constraints: QueryConstraint[]): Promise<T[]> {
    if (!constraints || constraints.length === 0) {
      return this.getAll();
    }
    return this.getAll(constraints);
  }
}

// Service instances
export const usersService = new FirestoreService<User>(COLLECTIONS.USERS);
export const unitsService = new FirestoreService<Unit>(COLLECTIONS.UNITS);
export const templatesService = new FirestoreService<ChecklistTemplate>(COLLECTIONS.TEMPLATES);
export const completedChecklistsService = new FirestoreService<CompletedChecklist>(COLLECTIONS.COMPLETED_CHECKLISTS);
export const notificationsService = new FirestoreService<Notification>(COLLECTIONS.NOTIFICATIONS);
export const auditLogService = new FirestoreService<AuditLogEntry>(COLLECTIONS.AUDIT_LOG);

// Specialized query functions
export const getUserByEmail = async (email: string): Promise<User | null> => {
  const users = await usersService.query([where('email', '==', email)]);
  return users.length > 0 ? users[0] : null;
};

export const getUsersByRole = async (role: string): Promise<User[]> => {
  return usersService.query([where('role', '==', role)]);
};

export const getUnitsByManagerId = async (managerId: string): Promise<Unit[]> => {
  return unitsService.query([where('managerId', '==', managerId)]);
};

export const getNotificationsByUserId = async (userId: string): Promise<Notification[]> => {
  return notificationsService.query([
    where('userId', '==', userId),
    orderBy('timestamp', 'desc')
  ]);
};

export const getCompletedChecklistsByTechnician = async (technicianId: string): Promise<CompletedChecklist[]> => {
  return completedChecklistsService.query([
    where('technicianId', '==', technicianId),
    orderBy('completionDate', 'desc')
  ]);
};

export const getRecentAuditLogs = async (limit: number = 50): Promise<AuditLogEntry[]> => {
  return auditLogService.query([
    orderBy('timestamp', 'desc')
  ]);
};