import React, { useState, useMemo, useEffect } from 'react';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";
import './index.css';
import { auth } from './firebase.ts';
import { User, Unit, ChecklistTemplate, CompletedChecklist, Notification, UserRole, ChecklistItemStatus, ChecklistItemResult, AuditLogEntry, ActionType, ChecklistItemTemplate } from './types.ts';
import { ICONS } from './constants.tsx';
import { 
  useUsers, 
  useUnits, 
  useTemplates, 
  useCompletedChecklists, 
  useNotifications, 
  useAuditLog 
} from './hooks/useFirestore.ts';
import { initializeFirestore } from './utils/initFirestore.ts';


type View = 'dashboard' | 'checklists' | 'templates' | 'admin' | 'notifications';
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';


const App: React.FC = () => {
    // Vite provides BASE_URL via import.meta.env; TS may not have the typing in this project, so coerce to any
    const BASE_URL = (import.meta as any).env?.BASE_URL || '/';
    // FIREBASE HOOKS
    const { users, getUserByEmailAddress, createUser: createUserInFirestore, updateUser: updateUserInFirestore, deleteUser: deleteUserInFirestore } = useUsers();
    const { units, createUnit: createUnitInFirestore, updateUnit: updateUnitInFirestore, deleteUnit: deleteUnitInFirestore } = useUnits();
    const { templates, createTemplate: createTemplateInFirestore, updateTemplate: updateTemplateInFirestore, deleteTemplate: deleteTemplateInFirestore } = useTemplates();
    const { completedChecklists, submitChecklist: submitChecklistToFirestore } = useCompletedChecklists();
    const { addAuditLog: addAuditLogToFirestore } = useAuditLog();
    
    // STATE MANAGEMENT
    const [activeView, setActiveView] = useState<View>('dashboard');
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
    const [authError, setAuthError] = useState<string | null>(null);
    const [showMobileNav, setShowMobileNav] = useState(false);

    // NOTIFICATIONS - initialized after currentUser is set
    const { notifications, createNotification, markAsRead } = useNotifications(currentUser?.id);

    // Initialize Firestore with initial data if empty
    useEffect(() => {
        initializeFirestore();
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
            if (firebaseUser && firebaseUser.email) {
                try {
                    // Look for user in Firestore
                    const appUser = await getUserByEmailAddress(firebaseUser.email);
                    if (appUser) {
                        // If user is marked inactive in Firestore, prevent login
                        if (appUser.active === false) {
                            console.warn('Authenticated Firebase user is deactivated in Firestore, signing out.');
                            await signOut(auth);
                            setCurrentUser(null);
                            setAuthStatus('unauthenticated');
                            return;
                        }
                        setCurrentUser(appUser);
                        setAuthStatus('authenticated');
                    } else {
                        // User authenticated with Firebase but not found in Firestore
                        // Create a minimal profile automatically so first-time auth users can proceed
                        try {
                            const displayName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Usuário';
                            const newUserData: Omit<User, 'id'> = {
                                name: displayName,
                                email: firebaseUser.email!,
                                role: UserRole.MANAGER, // default to MANAGER for first-time users; adjust as needed
                            };
                            const newId = await createUserInFirestore(newUserData);
                            // Try to read back the created user
                            const createdUser = await getUserByEmailAddress(firebaseUser.email!);
                            if (createdUser) {
                                setCurrentUser(createdUser);
                                setAuthStatus('authenticated');
                            } else {
                                // Fallback: set a local user object
                                setCurrentUser({ ...newUserData, id: newId });
                                setAuthStatus('authenticated');
                            }
                        } catch (err) {
                            console.error("Failed to create Firestore profile for authenticated user:", err);
                            // If creation fails, sign out to avoid inconsistent state
                            await signOut(auth);
                            setAuthStatus('unauthenticated');
                        }
                    }
                } catch (error) {
                    console.error("Error fetching user:", error);
                    setAuthStatus('unauthenticated');
                }
            } else {
                setCurrentUser(null);
                setAuthStatus('unauthenticated');
            }
        });
        return () => unsubscribe();
    }, [getUserByEmailAddress]);

    // Listen for header mobile menu toggle event
    useEffect(() => {
        const handler = () => setShowMobileNav(prev => !prev);
        window.addEventListener('toggleMobileNav', handler as EventListener);
        return () => window.removeEventListener('toggleMobileNav', handler as EventListener);
    }, []);


    const unreadNotifications = useMemo(() => {
        if (!currentUser) return [];
        return notifications.filter(n => n.userId === currentUser.id && !n.read);
    }, [notifications, currentUser]);

    const addAuditLog = async (action: ActionType, details: string) => {
        if (!currentUser) return;
        const newLog: Omit<AuditLogEntry, 'id'> = {
            timestamp: new Date().toISOString(),
            performingUserId: currentUser.id,
            action,
            details,
        };
        try {
            await addAuditLogToFirestore(newLog);
        } catch (error) {
            console.error('Error adding audit log:', error);
        }
    };

    const handleLogin = async (email: string, pass: string) => {
        setAuthError(null);
        try {
            await signInWithEmailAndPassword(auth, email, pass);
            // onAuthStateChanged will handle setting the user and status
        } catch (error: any) {
            console.error("Login Error:", error);
            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                 setAuthError('E-mail ou senha inválidos.');
            } else {
                setAuthError('Ocorreu um erro ao tentar fazer login.');
            }
        }
    };
    
    const handleLogout = async () => {
        await signOut(auth);
    };

    const handleCreateUser = async (userData: Omit<User, 'id'> & { password?: string }) => {
        try {
            const userId = await createUserInFirestore(userData as any);
            await addAuditLog(ActionType.USER_CREATED, `Criado usuário: ${userData.name} (${userData.role})`);
        } catch (error) {
            console.error('Error creating user:', error);
        }
    };

    const handleUpdateUser = async (userId: string, changes: Partial<User>) => {
        try {
            await updateUserInFirestore(userId, changes);
            await addAuditLog(ActionType.USER_UPDATED, `Atualizado usuário: ${userId}`);
        } catch (error) {
            console.error('Error updating user:', error);
        }
    };

    const handleDeleteUser = async (userId: string) => {
        try {
            // Try to fetch user to get authUid
            const userToDelete = users.find(u => u.id === userId);
            if (userToDelete?.authUid) {
                try {
                    // Call backend/cloud-function endpoint to delete the Auth user using Admin privileges
                    await fetch(`/api/deleteUser`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uid: userToDelete.authUid })
                    });
                } catch (err) {
                    console.warn('Could not delete auth user via backend function:', err);
                }
            }
            await deleteUserInFirestore(userId);
            await addAuditLog(ActionType.USER_UPDATED, `Removido usuário: ${userId}`);
        } catch (error) {
            console.error('Error deleting user:', error);
        }
    };

    const handleCreateUnit = async (unitData: Omit<Unit, 'id'>) => {
        try {
            const unitId = await createUnitInFirestore(unitData);
            await addAuditLog(ActionType.UNIT_CREATED, `Criada unidade: ${unitData.name}`);
        } catch (error) {
            console.error('Error creating unit:', error);
        }
    };

    const handleUpdateUnit = async (unitId: string, changes: Partial<Unit>) => {
        try {
            await updateUnitInFirestore(unitId, changes);
            await addAuditLog(ActionType.UNIT_UPDATED, `Atualizada unidade: ${unitId}`);
        } catch (error) {
            console.error('Error updating unit:', error);
        }
    };

    const handleDeleteUnit = async (unitId: string) => {
        try {
            await deleteUnitInFirestore(unitId);
            await addAuditLog(ActionType.UNIT_UPDATED, `Removida unidade: ${unitId}`);
        } catch (error) {
            console.error('Error deleting unit:', error);
        }
    };

    const submitChecklist = async (checklistData: Omit<CompletedChecklist, 'id' | 'completionDate' | 'hasNonConformities'>) => {
        if (!currentUser) return;
        
        try {
            const hasNonConformities = checklistData.results.some(r => r.status === ChecklistItemStatus.NON_CONFORM);
            
            const newCompletedChecklist: Omit<CompletedChecklist, 'id'> = {
                ...checklistData,
                completionDate: new Date().toISOString(),
                hasNonConformities,
            };

            const checklistId = await submitChecklistToFirestore(newCompletedChecklist);

            if (hasNonConformities) {
                const technician = users.find(u => u.id === checklistData.technicianId);
                const unit = units.find(u => u.id === checklistData.unitId);
                const template = templates.find(t => t.id === checklistData.templateId);

                // Notify unit manager
                const notifiedManagers = new Set<string>();
                if (unit && unit.managerId) {
                    const message = `Não conformidade registrada por ${technician?.name} na unidade ${unit.name} (Checklist: ${template?.name}).`;
                    await createNotification({
                        userId: unit.managerId,
                        completedChecklistId: checklistId,
                        message,
                        read: false,
                        timestamp: new Date().toISOString(),
                    });
                    notifiedManagers.add(unit.managerId);
                }

                // Notify technician's manager if different
                if (technician?.managerId && technician.managerId !== unit?.managerId && !notifiedManagers.has(technician.managerId)) {
                    const message = `Seu colaborador ${technician.name} registrou uma não conformidade na unidade ${unit?.name} (Checklist: ${template?.name}).`;
                    await createNotification({
                        userId: technician.managerId,
                        completedChecklistId: checklistId,
                        message,
                        read: false,
                        timestamp: new Date().toISOString(),
                    });
                    notifiedManagers.add(technician.managerId);
                }

                // Notify all coordinators (global)
                const coordinators = users.filter(u => u.role === UserRole.COORDINATOR && u.active !== false);
                for (const coord of coordinators) {
                    // Avoid duplicating notifications if coord is already notified above
                    if (notifiedManagers.has(coord.id)) continue;
                    const message = `Não conformidade registrada por ${technician?.name} na unidade ${unit?.name} (Checklist: ${template?.name}).`;
                    try {
                        await createNotification({
                            userId: coord.id,
                            completedChecklistId: checklistId,
                            message,
                            read: false,
                            timestamp: new Date().toISOString(),
                        });
                    } catch (err) {
                        console.warn('Falha ao notificar coordenador:', coord.id, err);
                    }
                }
            }
            setActiveView('checklists');
        } catch (error) {
            console.error('Error submitting checklist:', error);
        }
    };

    // --- TEMPLATE CRUD ---
    const handleCreateTemplate = async (templateData: Omit<ChecklistTemplate, 'id'>) => {
        try {
            const templateWithIds = {
                ...templateData,
                items: templateData.items.map((item, index) => ({ 
                    ...item, 
                    id: `item-${Date.now()}-${index}` 
                }))
            };
            await createTemplateInFirestore(templateWithIds);
        } catch (error) {
            console.error('Error creating template:', error);
        }
    };

    const handleUpdateTemplate = async (updatedTemplate: ChecklistTemplate) => {
        try {
            await updateTemplateInFirestore(updatedTemplate.id, updatedTemplate);
        } catch (error) {
            console.error('Error updating template:', error);
        }
    };

    const handleDeleteTemplate = async (templateId: string) => {
        const templateToDelete = templates.find(t => t.id === templateId);
        if (window.confirm(`Tem certeza de que deseja excluir o modelo "${templateToDelete?.name}"?`)) {
            try {
                await deleteTemplateInFirestore(templateId);
            } catch (error) {
                console.error('Error deleting template:', error);
            }
        }
    };


    const renderView = () => {
        if (!currentUser) return null; // Should not happen if authStatus is 'authenticated'
        switch (activeView) {
            case 'dashboard':
                return <DashboardView completedChecklists={completedChecklists} units={units} users={users} />;
            case 'checklists':
                return <ChecklistsView
                            templates={templates} 
                            units={units}
                            currentUser={currentUser}
                            completedChecklists={completedChecklists}
                            users={users}
                            onSubmit={submitChecklist}
                        />;
            case 'templates':
                return <TemplatesView 
                    templates={templates}
                    onCreate={handleCreateTemplate}
                    onUpdate={handleUpdateTemplate}
                    onDelete={handleDeleteTemplate}
                />;
            case 'admin':
                return <AdminView 
                    users={users} 
                    units={units} 
                    auditLog={[]} // Will be implemented with useAuditLog hook
                    onUserCreate={handleCreateUser}
                    onUnitCreate={handleCreateUnit}
                    onUserUpdate={handleUpdateUser}
                    onUserDelete={handleDeleteUser}
                    onUnitUpdate={handleUpdateUnit}
                    onUnitDelete={handleDeleteUnit}
                    managers={users.filter(u => u.role === UserRole.MANAGER)}
                />;
            case 'notifications':
                 const userNotifications = notifications
                    .filter(n => n.userId === currentUser.id)
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                return <NotificationsView notifications={userNotifications} markAsRead={markAsRead} />;
            default:
                return <DashboardView completedChecklists={completedChecklists} units={units} users={users} />;
        }
    };
    
    if (authStatus === 'loading') {
        return (
            <div className="flex items-center justify-center h-screen bg-slate-100">
                <div className="w-16 h-16 border-4 border-blue-500 border-dashed rounded-full animate-spin"></div>
            </div>
        );
    }
    
    if (authStatus === 'unauthenticated') {
        return <LoginView onLogin={handleLogin} error={authError} />;
    }

    if (!currentUser) {
        // This case should ideally not be reached if auth logic is correct
        return <LoginView onLogin={handleLogin} error="Ocorreu um erro. Por favor, faça login novamente." />;
    }


    return (
        <div className="flex h-screen bg-slate-100 text-slate-800">
            {/* Desktop sidebar (hidden on small screens via Tailwind) */}
            <div className="hidden md:flex">
                <Sidebar activeView={activeView} setActiveView={setActiveView} currentUser={currentUser} unreadCount={unreadNotifications.length} />
            </div>

            {/* Mobile off-canvas nav */}
            {showMobileNav && (
                <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setShowMobileNav(false)}>
                    <div className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-lg" onClick={e => e.stopPropagation()}>
                        <Sidebar activeView={activeView} setActiveView={(v) => { setActiveView(v); setShowMobileNav(false); }} currentUser={currentUser} unreadCount={unreadNotifications.length} />
                    </div>
                </div>
            )}

            <div className="flex-1 flex flex-col overflow-hidden mobile-full">
                <Header currentUser={currentUser} onLogout={handleLogout} unreadCount={unreadNotifications.length} setActiveView={setActiveView} />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-6">
                    {renderView()}
                </main>
            </div>
        </div>
    );
};

// --- AUTH VIEW ---

interface LoginViewProps {
  onLogin: (email: string, pass: string) => Promise<void>;
  error: string | null;
}
const LoginView: React.FC<LoginViewProps> = ({ onLogin, error }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        await onLogin(email, password);
        setIsLoading(false);
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-100">
            <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-lg shadow-lg">
                <div className="text-center">
                    <img src={`${BASE_URL}ambiental.svg`} alt="Ambiental - TST" className="mx-auto h-16 w-auto mb-4" />
                    <p className="mt-2 text-sm text-slate-500">Faça login para continuar</p>
                </div>
                <form className="space-y-6" onSubmit={handleSubmit}>
                     <div>
                        <label htmlFor="email" className="text-sm font-medium text-slate-700 sr-only">Email</label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            placeholder="E-mail"
                        />
                    </div>
                    <div>
                         <label htmlFor="password"className="text-sm font-medium text-slate-700 sr-only">Senha</label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Senha"
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-red-600 text-center">{error}</p>
                    )}

                    <div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-slate-400 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Entrando...' : 'Entrar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


// --- LAYOUT COMPONENTS ---

interface SidebarProps {
    activeView: View;
    setActiveView: (view: View) => void;
    currentUser: User;
    unreadCount: number;
}
const Sidebar: React.FC<SidebarProps> = ({ activeView, setActiveView, currentUser, unreadCount }) => {
    const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, roles: [UserRole.MANAGER, UserRole.TECHNICIAN, UserRole.COORDINATOR] },
    { id: 'checklists', label: 'Checklists', icon: ICONS.checklist, roles: [UserRole.MANAGER, UserRole.TECHNICIAN, UserRole.COORDINATOR] },
        { id: 'templates', label: 'Modelos', icon: ICONS.templates, roles: [UserRole.MANAGER] },
        { id: 'admin', label: 'Admin', icon: ICONS.admin, roles: [UserRole.MANAGER] },
    ];

    const filteredNavItems = navItems.filter(item => item.roles.includes(currentUser.role));

    return (
        <nav className="w-64 bg-white shadow-lg flex flex-col min-h-screen sticky top-0">
                <div className="flex items-center justify-center h-20 border-b border-slate-200">
                <img src={`${BASE_URL}ambiental.svg`} alt="Ambiental - TST" className="h-10 w-auto" />
            </div>
            <ul className="flex-1 mt-4">
                {filteredNavItems.map(item => (
                    <li key={item.id} className="px-4 mb-2">
                        <button
                            onClick={() => setActiveView(item.id as View)}
                            className={`w-full flex items-center p-3 rounded-lg transition-all duration-200 ${activeView === item.id ? 'bg-blue-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            {item.icon}
                            <span className="ml-4 font-semibold">{item.label}</span>
                        </button>
                    </li>
                ))}
                {currentUser.role === UserRole.MANAGER && (
                     <li className="px-4 mb-2">
                        <button
                            onClick={() => setActiveView('notifications')}
                            className={`w-full flex items-center p-3 rounded-lg transition-all duration-200 relative ${activeView === 'notifications' ? 'bg-blue-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            {unreadCount > 0 ? ICONS.bellAlert : ICONS.bell}
                            <span className="ml-4 font-semibold">Notificações</span>
                            {unreadCount > 0 && <span className="absolute right-3 top-1/2 -translate-y-1/2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">{unreadCount}</span>}
                        </button>
                    </li>
                )}
            </ul>
        </nav>
    );
};

interface HeaderProps {
    currentUser: User;
    onLogout: () => void;
    unreadCount: number;
    setActiveView: (view: View) => void;
}
const Header: React.FC<HeaderProps> = ({ currentUser, onLogout, unreadCount, setActiveView }) => (
    <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center space-x-4">
            {/* Mobile menu button (visible on small screens) */}
            <button className="md:hidden p-2 text-slate-600" onClick={() => {
                const ev = new CustomEvent('toggleMobileNav');
                window.dispatchEvent(ev);
            }} aria-label="Abrir menu">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
            <div className="hidden md:flex items-center">
                <h1 className="text-lg font-bold text-slate-700">Ambiental - TST</h1>
            </div>
        </div>
        <div className="flex items-center space-x-6">
            {(currentUser.role === UserRole.MANAGER || currentUser.role === UserRole.COORDINATOR) && (
                <button onClick={() => setActiveView('notifications')} className="relative text-slate-500 hover:text-slate-700">
                    {unreadCount > 0 ? ICONS.bellAlert : ICONS.bell}
                    {unreadCount > 0 && (
                        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                            {unreadCount}
                        </span>
                    )}
                </button>
            )}
             <div className="text-right hidden sm:block">
                <p className="font-semibold text-slate-800">{currentUser.name}</p>
                <p className="text-sm text-slate-500">{currentUser.role}</p>
            </div>
            <button onClick={onLogout} title="Sair" className="text-slate-500 hover:text-red-500 transition-colors">
                {ICONS.logout}
            </button>
        </div>
    </header>
);

// --- VIEW COMPONENTS ---

const DashboardView: React.FC<{completedChecklists: CompletedChecklist[], units: Unit[], users: User[]}> = ({ completedChecklists, units, users }) => {
    const nonConformities = completedChecklists.filter(c => c.hasNonConformities).length;
    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 text-slate-700">Dashboard</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-slate-500">Checklists Realizados</p>
                        <p className="text-3xl font-bold text-slate-800">{completedChecklists.length}</p>
                    </div>
                    <div className="bg-blue-100 text-blue-500 p-3 rounded-full">{ICONS.checklist}</div>
                </div>
                 <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-slate-500">Não Conformidades</p>
                        <p className={`text-3xl font-bold ${nonConformities > 0 ? 'text-red-500' : 'text-slate-800'}`}>{nonConformities}</p>
                    </div>
                    <div className="bg-red-100 text-red-500 p-3 rounded-full">{ICONS.xCircle}</div>
                </div>
                 <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-slate-500">Unidades</p>
                        <p className="text-3xl font-bold text-slate-800">{units.length}</p>
                    </div>
                    <div className="bg-green-100 text-green-500 p-3 rounded-full">{ICONS.admin}</div>
                </div>
                 <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-slate-500">Usuários Ativos</p>
                        <p className="text-3xl font-bold text-slate-800">{users.length}</p>
                    </div>
                    <div className="bg-yellow-100 text-yellow-500 p-3 rounded-full">{ICONS.admin}</div>
                </div>
            </div>
            {/* Add more charts or summaries here */}
        </div>
    );
};

interface ChecklistsViewProps {
    templates: ChecklistTemplate[];
    units: Unit[];
    currentUser: User;
    completedChecklists: CompletedChecklist[];
    users: User[];
    onSubmit: (data: Omit<CompletedChecklist, 'id' | 'completionDate' | 'hasNonConformities'>) => void;
}
interface ChecklistsViewProps {
    templates: ChecklistTemplate[];
    units: Unit[];
    currentUser: User;
    completedChecklists: CompletedChecklist[];
    users: User[];
    onSubmit: (data: Omit<CompletedChecklist, 'id' | 'completionDate' | 'hasNonConformities'>) => void;
    createNotification: (n: Omit<Notification, 'id'>) => Promise<void>;
}

const ChecklistsView: React.FC<ChecklistsViewProps> = ({ templates, units, currentUser, completedChecklists, users, onSubmit }) => {
    const [viewMode, setViewMode] = useState<'list' | 'execute'>('list');
    const [selectedTemplate, setSelectedTemplate] = useState<ChecklistTemplate | null>(null);
    const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
    const [results, setResults] = useState<ChecklistItemResult[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [modalTemplateId, setModalTemplateId] = useState('');
    const [modalUnitId, setModalUnitId] = useState('');
    const [modalPerformerId, setModalPerformerId] = useState('');
    const [executingPerformerId, setExecutingPerformerId] = useState<string | null>(null);
    const [showFilters, setShowFilters] = useState(true);

    // Modal state for viewing/validating a completed checklist
    const [viewingChecklist, setViewingChecklist] = useState<CompletedChecklist | null>(null);
    const [managerComment, setManagerComment] = useState('');
    const { updateChecklist } = useCompletedChecklists();

    // Filters
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');
    const [filterUnitId, setFilterUnitId] = useState('');
    const [filterTechnicianId, setFilterTechnicianId] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'conform' | 'non-conform'>('all');

    useEffect(() => {
        try { setShowFilters(window.innerWidth >= 768); } catch { setShowFilters(true); }
    }, []);

    const technicians = useMemo(() => users.filter(u => u.role === UserRole.TECHNICIAN), [users]);

    const filteredChecklists = useMemo(() => {
        let checklists = completedChecklists
            .filter(c => currentUser.role === UserRole.TECHNICIAN ? c.technicianId === currentUser.id : true)
            .sort((a, b) => new Date(b.completionDate).getTime() - new Date(a.completionDate).getTime());

        if (filterDateFrom) checklists = checklists.filter(c => new Date(c.completionDate) >= new Date(filterDateFrom));
        if (filterDateTo) { const endDate = new Date(filterDateTo); endDate.setDate(endDate.getDate() + 1); checklists = checklists.filter(c => new Date(c.completionDate) < endDate); }
        if (filterUnitId) checklists = checklists.filter(c => c.unitId === filterUnitId);
        if (filterTechnicianId) checklists = checklists.filter(c => c.technicianId === filterTechnicianId);
        if (filterStatus !== 'all') { const hasNonConformities = filterStatus === 'non-conform'; checklists = checklists.filter(c => c.hasNonConformities === hasNonConformities); }
        return checklists;
    }, [completedChecklists, currentUser, filterDateFrom, filterDateTo, filterUnitId, filterTechnicianId, filterStatus]);

    const clearFilters = () => { setFilterDateFrom(''); setFilterDateTo(''); setFilterUnitId(''); setFilterTechnicianId(''); setFilterStatus('all'); };

    // Start checklist using selected modal values
    const handleStartChecklist = (templateId?: string, unitId?: string, performerId?: string) => {
        const tId = templateId || modalTemplateId;
        const uId = unitId || modalUnitId;
        const performer = performerId || modalPerformerId || currentUser.id;
        const tmpl = templates.find(t => t.id === tId);
        const unit = units.find(u => u.id === uId);
        if (!tmpl || !unit) {
            alert('Selecione modelo e unidade antes de iniciar.');
            return;
        }
        setSelectedTemplate(tmpl);
        setSelectedUnit(unit);
        setExecutingPerformerId(performer);
        setResults(tmpl.items.map(item => ({ itemId: item.id, status: null, observation: '' })));
        setShowModal(false);
        setViewMode('execute');
    };

    const handleResultChange = (itemId: string, status: ChecklistItemStatus, observation: string = '') => {
        setResults(prev => prev.map(r => r.itemId === itemId ? { ...r, status, observation } : r));
    };

    const handleSubmit = () => {
        if (!selectedTemplate || !selectedUnit || results.some(r => r.status === null)) { alert('Por favor, preencha todos os itens do checklist.'); return; }
        onSubmit({ templateId: selectedTemplate.id, unitId: selectedUnit.id, technicianId: executingPerformerId || currentUser.id, results });
        setViewMode('list'); setSelectedTemplate(null); setSelectedUnit(null); setResults([]); setExecutingPerformerId(null);
    };

    // Mobile stepper
    const [stepIndex, setStepIndex] = useState(0);
    useEffect(() => { setStepIndex(0); }, [results.length]);

    if (viewMode === 'execute' && selectedTemplate) {
        const currentItem = selectedTemplate.items[stepIndex];
        const handlePrev = () => setStepIndex(i => Math.max(0, i - 1));
        const handleNext = () => {
            const res = results.find(r => r.itemId === currentItem.id);
            if (!res || res.status === null) { alert('Por favor, responda o item antes de avançar.'); return; }
            if (stepIndex < selectedTemplate.items.length - 1) setStepIndex(i => i + 1); else handleSubmit();
        };

        return (
            <div>
                <button onClick={() => setViewMode('list')} className="mb-4 text-blue-500 hover:underline">&larr; Voltar</button>
                <h2 className="text-2xl font-bold mb-2 text-slate-700">{selectedTemplate.name}</h2>
                <p className="text-slate-500 mb-6">Unidade: <span className="font-semibold">{selectedUnit?.name}</span></p>

                <div className="md:hidden">
                    <div className="bg-white p-4 rounded-lg shadow-md step-card">
                        <p className="font-semibold mb-2">{stepIndex + 1}. {currentItem.text}</p>
                        <div className="flex flex-col space-y-3 mt-4">
                            <button onClick={() => handleResultChange(currentItem.id, ChecklistItemStatus.CONFORM, results.find(r => r.itemId === currentItem.id)?.observation)} className={`w-full py-3 rounded-md ${results.find(r => r.itemId === currentItem.id && r.status === ChecklistItemStatus.CONFORM) ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700'}`}>Conforme</button>
                            <button onClick={() => handleResultChange(currentItem.id, ChecklistItemStatus.NON_CONFORM, results.find(r => r.itemId === currentItem.id)?.observation)} className={`w-full py-3 rounded-md ${results.find(r => r.itemId === currentItem.id && r.status === ChecklistItemStatus.NON_CONFORM) ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}>Não Conforme</button>
                            {results.find(r => r.itemId === currentItem.id && r.status === ChecklistItemStatus.NON_CONFORM) && (
                                <textarea placeholder="Observação (obrigatório para não conformidade)" className="w-full mt-2 p-3 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none" rows={3} value={results.find(r => r.itemId === currentItem.id)?.observation || ''} onChange={(e) => handleResultChange(currentItem.id, ChecklistItemStatus.NON_CONFORM, e.target.value)} />
                            )}
                        </div>
                    </div>

                    <div className="sticky-footer mt-4 flex items-center space-x-3">
                        <button onClick={handlePrev} disabled={stepIndex === 0} className="flex-1 py-3 rounded-md bg-slate-100 text-slate-700 disabled:opacity-50">Anterior</button>
                        <button onClick={handleNext} className="flex-1 py-3 rounded-md bg-blue-600 text-white">{stepIndex < selectedTemplate.items.length - 1 ? 'Próximo' : 'Finalizar'}</button>
                    </div>
                </div>

                <div className="hidden md:block bg-white p-6 rounded-lg shadow-md space-y-6">
                    {selectedTemplate.items.map((item, index) => {
                        const result = results.find(r => r.itemId === item.id);
                        return (
                            <div key={item.id} className="border-b border-slate-200 pb-4">
                                <p className="font-semibold mb-2">{index + 1}. {item.text}</p>
                                <div className="flex items-center space-x-4 mb-2">
                                    <label className="flex items-center cursor-pointer"><input type="radio" name={`status-${item.id}`} className="form-radio h-4 w-4 text-green-600" onChange={() => handleResultChange(item.id, ChecklistItemStatus.CONFORM, result?.observation)} /><span className="ml-2 text-green-700">Conforme</span></label>
                                    <label className="flex items-center cursor-pointer"><input type="radio" name={`status-${item.id}`} className="form-radio h-4 w-4 text-red-600" onChange={() => handleResultChange(item.id, ChecklistItemStatus.NON_CONFORM, result?.observation)} /><span className="ml-2 text-red-700">Não Conforme</span></label>
                                </div>
                                {result?.status === ChecklistItemStatus.NON_CONFORM && (
                                    <textarea placeholder="Observação (obrigatório para não conformidade)" className="w-full mt-2 p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none" rows={2} value={result.observation} onChange={(e) => handleResultChange(item.id, ChecklistItemStatus.NON_CONFORM, e.target.value)} />
                                )}
                            </div>
                        );
                    })}
                    <button onClick={handleSubmit} className="w-full bg-blue-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-600 transition-colors">Finalizar e Enviar Checklist</button>
                </div>
            </div>
        );
    }

    const openChecklistModal = (c: CompletedChecklist) => {
        setViewingChecklist(c);
        setManagerComment(c.managerComment || '');
    };

    const closeChecklistModal = () => {
        setViewingChecklist(null);
        setManagerComment('');
    };

    const validateChecklist = async () => {
        if (!viewingChecklist) return;
        try {
            const updated: Partial<CompletedChecklist> = {
                validated: true,
                validatedBy: currentUser.id,
                validatedAt: new Date().toISOString(),
                managerComment
            };
            await updateChecklist(viewingChecklist.id, updated as any);
            // Update local state: find and replace in completedChecklists is handled by hook subscription
            closeChecklistModal();
            alert('Checklist validado com sucesso.');
        } catch (err) {
            console.error('Erro validando checklist:', err);
            alert('Erro ao validar checklist. Veja o console para detalhes.');
        }
    };

    return (
        <div>
            <div className="mb-4">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-3xl font-bold text-slate-700">Checklists</h2>
                    <div className="flex items-center space-x-2">
                        {(currentUser.role === UserRole.TECHNICIAN || currentUser.role === UserRole.MANAGER) && (
                            <button onClick={() => { setModalTemplateId(''); setModalUnitId(''); setModalPerformerId(currentUser.id); setShowModal(true); }} className="flex items-center space-x-2 bg-white p-2 rounded-lg shadow-sm hover:shadow-md">
                                <span className="p-2 bg-blue-100 text-blue-700 rounded-md">{ICONS.add}</span>
                                <span className="font-medium text-slate-700">Novo</span>
                            </button>
                        )}
                    </div>
                </div>

                {showFilters ? (
                    <div className="bg-white p-4 rounded-lg border border-slate-200 mb-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {currentUser.role === UserRole.MANAGER && (
                                <div>
                                    <label className="text-sm font-medium text-slate-600 block mb-1">Técnico</label>
                                    <select value={filterTechnicianId} onChange={e => setFilterTechnicianId(e.target.value)} className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                        <option value="">Todos</option>
                                        {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label className="text-sm font-medium text-slate-600 block mb-1">Status</label>
                                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                    <option value="all">Todos</option>
                                    <option value="conform">Conforme</option>
                                    <option value="non-conform">Não Conforme</option>
                                </select>
                            </div>
                            <div className="md:col-span-2 flex items-end justify-end">
                                <button onClick={clearFilters} className="bg-slate-500 text-white font-bold py-2 px-4 rounded-md hover:bg-slate-600 transition-colors text-sm">Limpar Filtros</button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 mb-4 flex items-center justify-between">
                        <div className="text-sm text-slate-600"> </div>
                        <button onClick={() => setShowFilters(true)} className="text-sm text-blue-600">Mostrar</button>
                    </div>
                )}

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                                <tr className="border-b bg-slate-50">
                                <th className="p-3">Data</th>
                                <th className="p-3">Modelo</th>
                                <th className="p-3">Unidade</th>
                                {currentUser.role === UserRole.MANAGER && <th className="p-3">Técnico</th>}
                                <th className="p-3">Status</th>
                                <th className="p-3">Validado por</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredChecklists.map(c => {
                                const template = templates.find(t => t.id === c.templateId);
                                const unit = units.find(u => u.id === c.unitId);
                                const technician = users.find(u => u.id === c.technicianId);
                                return (
                                    <tr key={c.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => openChecklistModal(c)}>
                                        <td className="p-3">{new Date(c.completionDate).toLocaleString()}</td>
                                        <td className="p-3 font-medium">{template?.name}</td>
                                        <td className="p-3">{unit?.name}</td>
                                        {currentUser.role === UserRole.MANAGER && <td className="p-3">{technician?.name}</td>}
                                        <td className="p-3">
                                            {c.hasNonConformities ? <span className="bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">Não Conforme</span> : <span className="bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">Conforme</span>}
                                            {c.validated && <span className="ml-2 bg-blue-100 text-blue-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">Validado</span>}
                                        </td>
                                        <td className="p-3">{c.validatedBy ? (users.find(u => u.id === c.validatedBy)?.name || c.validatedBy) : '-'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {filteredChecklists.length === 0 && <p className="text-center text-slate-500 py-8">Nenhum checklist encontrado para os filtros selecionados.</p>}
                </div>
                {/* Modal para visualizar/validar checklist */}
                {viewingChecklist && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                        <div className="bg-white w-11/12 md:w-1/2 rounded-lg p-6 max-h-[80vh] overflow-y-auto">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold">Checklist - {templates.find(t => t.id === viewingChecklist.templateId)?.name}</h3>
                                <button onClick={closeChecklistModal} className="text-slate-500 hover:text-slate-700">Fechar</button>
                            </div>
                            <p className="text-sm text-slate-600 mb-3">Unidade: <span className="font-semibold">{units.find(u => u.id === viewingChecklist.unitId)?.name}</span></p>
                            <p className="text-sm text-slate-600 mb-4">Executante: <span className="font-semibold">{users.find(u => u.id === viewingChecklist.technicianId)?.name}</span></p>
                            <div className="space-y-4">
                                {viewingChecklist.results.map((res, idx) => (
                                    <div key={res.itemId} className="border-b pb-3">
                                        <p className="font-semibold">{idx + 1}. {templates.find(t => t.id === viewingChecklist.templateId)?.items.find(i => i.id === res.itemId)?.text}</p>
                                        <p className={`text-sm ${res.status === ChecklistItemStatus.NON_CONFORM ? 'text-red-700' : 'text-green-700'}`}>{res.status}</p>
                                        {res.observation && <p className="text-sm text-slate-600 mt-1">Observação: {res.observation}</p>}
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4">
                                <label className="block text-sm font-medium text-slate-700">Comentário do gestor</label>
                                <textarea value={managerComment} onChange={e => setManagerComment(e.target.value)} disabled={currentUser.role !== UserRole.MANAGER} className="w-full mt-1 p-2 border border-slate-300 rounded-md" rows={3} />
                            </div>
                            <div className="mt-4 flex justify-end space-x-2">
                                <button onClick={closeChecklistModal} className="px-4 py-2 rounded bg-gray-100">Fechar</button>
                                {currentUser.role === UserRole.MANAGER && (
                                    <button onClick={validateChecklist} className="px-4 py-2 rounded bg-blue-600 text-white">Validar checklist</button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Modal to start checklist */}
            {showModal && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white w-11/12 md:w-1/2 rounded-lg p-6">
                        <h3 className="text-lg font-semibold mb-4">Iniciar novo checklist</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700">Modelo</label>
                                <select value={modalTemplateId} onChange={e => setModalTemplateId(e.target.value)} className="mt-1 block w-full rounded-md border-gray-200 shadow-sm">
                                    <option value="">-- selecione --</option>
                                    {templates.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700">Unidade</label>
                                <select value={modalUnitId} onChange={e => setModalUnitId(e.target.value)} className="mt-1 block w-full rounded-md border-gray-200 shadow-sm">
                                    <option value="">-- selecione --</option>
                                    {units.filter(u => u.active !== false).map(u => (<option key={u.id} value={u.id}>{u.name}</option>))}
                                </select>
                            </div>
                            {currentUser.role === UserRole.MANAGER && (
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700">Executante</label>
                                    <select value={modalPerformerId} onChange={e => setModalPerformerId(e.target.value)} className="mt-1 block w-full rounded-md border-gray-200 shadow-sm">
                                        <option value="">-- selecione --</option>
                                        <option value={currentUser.id}>Eu ({currentUser.name})</option>
                                        {users.filter(u => u.role === UserRole.TECHNICIAN && u.active !== false).map(u => (<option key={u.id} value={u.id}>{u.name} — {u.email}</option>))}
                                    </select>
                                </div>
                            )}
                        </div>
                        <div className="mt-4 flex justify-end space-x-2">
                            <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded bg-gray-100">Cancelar</button>
                            <button onClick={() => { const performer = modalPerformerId || currentUser.id; handleStartChecklist(modalTemplateId, modalUnitId, performer); }} className="px-4 py-2 rounded bg-blue-600 text-white">Iniciar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface TemplatesViewProps {
    templates: ChecklistTemplate[];
    onCreate: (template: Omit<ChecklistTemplate, 'id'>) => void;
    onUpdate: (template: ChecklistTemplate) => void;
    onDelete: (templateId: string) => void;
}

const TemplatesView: React.FC<TemplatesViewProps> = ({ templates, onCreate, onUpdate, onDelete }) => {
    const [mode, setMode] = useState<'list' | 'edit'>('list');
    const [currentTemplate, setCurrentTemplate] = useState<ChecklistTemplate | null>(null);

    const handleEdit = (template: ChecklistTemplate) => {
        setCurrentTemplate(JSON.parse(JSON.stringify(template))); // Deep copy
        setMode('edit');
    };

    const handleCreate = () => {
        setCurrentTemplate({
            id: '', // Empty id signifies a new template
            name: '',
            items: [{ id: `new-${Date.now()}`, text: '' }]
        });
        setMode('edit');
    };

    const handleCancel = () => {
        setCurrentTemplate(null);
        setMode('list');
    };

    const handleSave = () => {
        if (!currentTemplate || !currentTemplate.name.trim()) {
            alert("O nome do modelo não pode estar vazio.");
            return;
        }
        if (currentTemplate.items.some(item => !item.text.trim())) {
             alert("Todos os itens devem ter uma descrição.");
             return;
        }

        if (currentTemplate.id) {
            onUpdate(currentTemplate);
        } else {
            const { id, ...newTemplateData } = currentTemplate;
            onCreate(newTemplateData);
        }
        handleCancel();
    };

    const updateTemplateName = (name: string) => {
        if(currentTemplate) setCurrentTemplate({...currentTemplate, name});
    };

    const updateItemText = (itemId: string, text: string) => {
        if(currentTemplate) {
            const updatedItems = currentTemplate.items.map(item =>
                item.id === itemId ? { ...item, text } : item
            );
            setCurrentTemplate({ ...currentTemplate, items: updatedItems });
        }
    };

    const addItem = () => {
        if(currentTemplate) {
            const newItem: ChecklistItemTemplate = { id: `new-${Date.now()}`, text: '' };
            setCurrentTemplate({ ...currentTemplate, items: [...currentTemplate.items, newItem] });
        }
    };

    const removeItem = (itemId: string) => {
         if(currentTemplate && currentTemplate.items.length > 1) {
            const updatedItems = currentTemplate.items.filter(item => item.id !== itemId);
            setCurrentTemplate({ ...currentTemplate, items: updatedItems });
        } else {
            alert("Um modelo deve ter pelo menos um item.");
        }
    };

    if (mode === 'edit' && currentTemplate) {
        return (
            <div>
                 <button onClick={handleCancel} className="mb-4 text-blue-500 hover:underline">&larr; Voltar para a lista</button>
                 <div className="bg-white p-6 rounded-lg shadow-md">
                     <h2 className="text-2xl font-bold mb-6 text-slate-700">{currentTemplate.id ? 'Editar Modelo' : 'Criar Novo Modelo'}</h2>
                     <div className="space-y-4">
                         <div>
                             <label className="text-sm font-medium text-slate-600 block mb-1">Nome do Modelo</label>
                             <input 
                                type="text" 
                                value={currentTemplate.name}
                                onChange={e => updateTemplateName(e.target.value)}
                                placeholder="Ex: Inspeção de Extintores"
                                className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                             />
                         </div>
                         <div>
                            <h3 className="text-lg font-semibold text-slate-600 mb-2">Itens do Checklist</h3>
                            <div className="space-y-3">
                                {currentTemplate.items.map((item, index) => (
                                    <div key={item.id} className="flex items-center space-x-2">
                                        <span className="text-slate-500 font-semibold">{index + 1}.</span>
                                        <input 
                                            type="text"
                                            value={item.text}
                                            onChange={e => updateItemText(item.id, e.target.value)}
                                            placeholder="Descrição do item"
                                            className="flex-grow bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button onClick={() => removeItem(item.id)} className="p-2 text-red-500 hover:bg-red-100 rounded-full transition-colors">
                                            {ICONS.trash}
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button onClick={addItem} className="mt-4 bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-md hover:bg-slate-300 transition-colors text-sm flex items-center">
                                {ICONS.add} Adicionar Item
                            </button>
                         </div>
                         <div className="flex justify-end space-x-3 pt-4">
                             <button onClick={handleCancel} className="bg-slate-500 text-white font-bold py-2 px-6 rounded-md hover:bg-slate-600 transition-colors">Cancelar</button>
                             <button onClick={handleSave} className="bg-blue-500 text-white font-bold py-2 px-6 rounded-md hover:bg-blue-600 transition-colors">Salvar</button>
                         </div>
                     </div>
                 </div>
            </div>
        )
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold text-slate-700">Modelos de Checklist</h2>
                <button onClick={handleCreate} className="bg-blue-500 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-600 transition-colors flex items-center">
                    {ICONS.add} Criar Modelo
                </button>
            </div>
            <div className="space-y-4">
                {templates.map(template => (
                    <div key={template.id} className="bg-white p-6 rounded-lg shadow-md">
                        <div className="flex justify-between items-start">
                             <div>
                                <h3 className="text-xl font-semibold text-slate-800">{template.name}</h3>
                                <ul className="list-disc list-inside mt-2 text-slate-600 space-y-1">
                                    {template.items.map(item => <li key={item.id}>{item.text}</li>)}
                                </ul>
                             </div>
                             <div className="flex space-x-2 flex-shrink-0 ml-4">
                                <button onClick={() => handleEdit(template)} className="p-2 text-slate-500 hover:bg-slate-200 rounded-full transition-colors" title="Editar">{ICONS.edit}</button>
                                <button onClick={() => onDelete(template.id)} className="p-2 text-red-500 hover:bg-red-100 rounded-full transition-colors" title="Excluir">{ICONS.trash}</button>
                             </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

interface AdminViewProps {
    users: User[];
    units: Unit[];
    auditLog: AuditLogEntry[];
    onUserCreate: (user: Omit<User, 'id'>) => void;
    onUnitCreate: (unit: Omit<Unit, 'id'>) => void;
    onUserUpdate?: (userId: string, changes: Partial<User>) => void;
    onUserDelete?: (userId: string) => void;
    onUnitUpdate?: (unitId: string, changes: Partial<Unit>) => void;
    onUnitDelete?: (unitId: string) => void;
    managers: User[];
}
const AdminView: React.FC<AdminViewProps> = ({ users, units, auditLog, onUserCreate, onUnitCreate, onUserUpdate, onUserDelete, onUnitUpdate, onUnitDelete, managers }) => {
    const [showAddUser, setShowAddUser] = useState(false);
    const [showAddUnit, setShowAddUnit] = useState(false);
    // Edit user modal state
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [editName, setEditName] = useState('');
    const [editRole, setEditRole] = useState<UserRole>(UserRole.TECHNICIAN);
    const [editManagerId, setEditManagerId] = useState('');
    const [editPassword, setEditPassword] = useState('');
    const [editPasswordConfirm, setEditPasswordConfirm] = useState('');
    const [showEditModal, setShowEditModal] = useState(false);
    
    // User form state
    const [newUserName, setNewUserName] = useState('');
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserPassword, setNewUserPassword] = useState('');
    const [newUserPasswordConfirm, setNewUserPasswordConfirm] = useState('');
    const [newUserRole, setNewUserRole] = useState<UserRole>(UserRole.TECHNICIAN);
    const [newUserManangerId, setNewUserManangerId] = useState('');

    // Unit form state
    const [newUnitName, setNewUnitName] = useState('');
    const [newUnitManagerId, setNewUnitManagerId] = useState('');

    // Edit unit state
    const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
    const [editUnitName, setEditUnitName] = useState('');
    const [editUnitManagerId, setEditUnitManagerId] = useState('');

    const handleUserSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newUserPassword !== newUserPasswordConfirm) {
            alert('As senhas não coincidem. Corrija antes de salvar.');
            return;
        }
        onUserCreate({
            name: newUserName,
            email: newUserEmail,
            password: newUserPassword,
            role: newUserRole,
            managerId: newUserRole === UserRole.TECHNICIAN ? newUserManangerId : undefined
        });
        setNewUserName('');
        setNewUserEmail('');
        setNewUserPassword('');
        setNewUserPasswordConfirm('');
        setNewUserRole(UserRole.TECHNICIAN);
        setNewUserManangerId('');
        setShowAddUser(false);
    };
    
    const handleUnitSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onUnitCreate({
            name: newUnitName,
            managerId: newUnitManagerId
        });
        setNewUnitName('');
        setNewUnitManagerId('');
        setShowAddUnit(false);
    };

    const openUnitEditForm = (unit: Unit) => {
        setEditingUnit(unit);
        setEditUnitName(unit.name);
        setEditUnitManagerId(unit.managerId ?? '');
    };

    const cancelUnitEdit = () => {
        setEditingUnit(null);
        setEditUnitName('');
        setEditUnitManagerId('');
    };

    const handleUnitEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingUnit || typeof onUnitUpdate !== 'function') {
            cancelUnitEdit();
            return;
        }
        try {
            await onUnitUpdate(editingUnit.id, {
                name: editUnitName,
                managerId: editUnitManagerId
            });
            cancelUnitEdit();
        } catch (err) {
            console.error('Erro ao atualizar unidade:', err);
        }
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 text-slate-700">Administração</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* USERS */}
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-semibold text-slate-600">Usuários</h3>
                        <button onClick={() => setShowAddUser(!showAddUser)} className="bg-blue-500 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-600 transition-colors text-sm flex items-center">{ICONS.add} Adicionar</button>
                    </div>
                    {showAddUser && (
                        <form onSubmit={handleUserSubmit} className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-4 space-y-3">
                            <input type="text" placeholder="Nome" value={newUserName} onChange={e => setNewUserName(e.target.value)} required className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            <input type="email" placeholder="Email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} required className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            <input type="password" placeholder="Senha" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} required className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            <input type="password" placeholder="Confirmar senha" value={newUserPasswordConfirm} onChange={e => setNewUserPasswordConfirm(e.target.value)} required className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            <select value={newUserRole} onChange={e => setNewUserRole(e.target.value as UserRole)} className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value={UserRole.TECHNICIAN}>Técnico</option>
                                <option value={UserRole.MANAGER}>Gestor</option>
                                <option value={UserRole.COORDINATOR}>Coordenador</option>
                            </select>
                            {newUserRole === UserRole.TECHNICIAN && (
                                <select value={newUserManangerId} onChange={e => setNewUserManangerId(e.target.value)} required className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                    <option value="">Selecione o Gestor</option>
                                    {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                            )}
                            <div className="flex justify-end space-x-2">
                                <button type="button" onClick={() => setShowAddUser(false)} className="bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-md hover:bg-slate-300 transition-colors text-sm">Cancelar</button>
                                <button type="submit" className="bg-green-500 text-white font-bold py-2 px-4 rounded-md hover:bg-green-600 transition-colors text-sm">Salvar</button>
                            </div>
                        </form>
                    )}
                    <ul className="divide-y divide-slate-200">
                        {users.map(u => (
                            <li key={u.id} className="flex items-center justify-between p-2">
                                <div>
                                    <div className="font-medium">{u.name} {u.active === false && <span className="text-xs text-red-500 ml-2">(Desativado)</span>}</div>
                                    <div className="text-sm text-slate-500">{u.email} • {u.role}</div>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button onClick={async () => {
                                        // Toggle active
                                        if (typeof onUserUpdate === 'function') {
                                            onUserUpdate(u.id, { active: !(u.active ?? true) });
                                        }
                                    }} className={`py-1 px-2 text-sm rounded-md ${u.active === false ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                                        {u.active === false ? 'Ativar' : 'Desativar'}
                                    </button>
                                    <button onClick={() => {
                                        // open edit modal
                                        setEditingUser(u);
                                        setEditName(u.name);
                                        setEditRole(u.role);
                                        setEditManagerId(u.managerId ?? '');
                                        setEditPassword('');
                                        setEditPasswordConfirm('');
                                        setShowEditModal(true);
                                    }} className="py-1 px-2 bg-blue-500 text-white text-sm rounded-md">Editar</button>
                                    <button onClick={async () => {
                                        if (window.confirm(`Excluir usuário ${u.name}? Esta ação é irreversível.`)) {
                                            if (typeof onUserDelete === 'function') {
                                                onUserDelete(u.id);
                                            }
                                        }
                                    }} className="py-1 px-2 bg-red-100 text-red-700 text-sm rounded-md">Excluir</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                    {/* Edit User Modal */}
                    {showEditModal && editingUser && (
                        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                            <div className="bg-white w-11/12 md:w-1/3 rounded-lg p-6">
                                <h3 className="text-lg font-semibold mb-4">Editar Usuário</h3>
                                <form onSubmit={async (e) => {
                                    e.preventDefault();
                                    if (!editingUser) return;
                                    if (editPassword || editPasswordConfirm) {
                                        if (editPassword !== editPasswordConfirm) { alert('As senhas não coincidem.'); return; }
                                    }
                                    const changes: Partial<User> = { name: editName, role: editRole };
                                    if (editRole === UserRole.TECHNICIAN) changes.managerId = editManagerId || undefined;
                                    else changes.managerId = undefined;
                                    try {
                                        if (typeof onUserUpdate === 'function') {
                                            await onUserUpdate(editingUser.id, changes);
                                        }
                                        // If password provided, attempt to update via backend endpoint
                                        if (editPassword && editingUser.authUid) {
                                            try {
                                                await fetch('/api/updateUserPassword', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ uid: editingUser.authUid, password: editPassword })
                                                });
                                            } catch (pwErr) {
                                                console.warn('Failed to request password update on backend:', pwErr);
                                            }
                                        }
                                        setShowEditModal(false);
                                        setEditingUser(null);
                                    } catch (err) {
                                        console.error('Error updating user from modal:', err);
                                        alert('Erro ao salvar usuário. Veja o console para detalhes.');
                                    }
                                }}>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-sm font-medium text-slate-600 block mb-1">Nome</label>
                                            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} required className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium text-slate-600 block mb-1">Perfil</label>
                                            <select value={editRole} onChange={e => setEditRole(e.target.value as UserRole)} className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                                <option value={UserRole.TECHNICIAN}>Técnico</option>
                                                <option value={UserRole.MANAGER}>Gestor</option>
                                                <option value={UserRole.COORDINATOR}>Coordenador</option>
                                            </select>
                                        </div>
                                        {editRole === UserRole.TECHNICIAN && (
                                            <div>
                                                <label className="text-sm font-medium text-slate-600 block mb-1">Gestor</label>
                                                <select value={editManagerId} onChange={e => setEditManagerId(e.target.value)} className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                                    <option value="">Selecione o gestor</option>
                                                    {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                                </select>
                                            </div>
                                        )}
                                        <div>
                                            <label className="text-sm font-medium text-slate-600 block mb-1">Senha (deixe em branco para não alterar)</label>
                                            <input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium text-slate-600 block mb-1">Confirmar Senha</label>
                                            <input type="password" value={editPasswordConfirm} onChange={e => setEditPasswordConfirm(e.target.value)} className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                        </div>
                                        <div className="flex justify-end space-x-2 pt-2">
                                            <button type="button" onClick={() => { setShowEditModal(false); setEditingUser(null); }} className="bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-md hover:bg-slate-300 transition-colors text-sm">Cancelar</button>
                                            <button type="submit" className="bg-green-500 text-white font-bold py-2 px-4 rounded-md hover:bg-green-600 transition-colors text-sm">Salvar</button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}
                </div>
                {/* UNITS */}
                <div className="bg-white p-6 rounded-lg shadow-md">
                     <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-semibold text-slate-600">Unidades</h3>
                        <button onClick={() => setShowAddUnit(!showAddUnit)} className="bg-blue-500 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-600 transition-colors text-sm flex items-center">{ICONS.add} Adicionar</button>
                    </div>
                    {showAddUnit && (
                        <form onSubmit={handleUnitSubmit} className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-4 space-y-3">
                            <input type="text" placeholder="Nome da Unidade" value={newUnitName} onChange={e => setNewUnitName(e.target.value)} required className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            <select value={newUnitManagerId} onChange={e => setNewUnitManagerId(e.target.value)} required className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="">Selecione o Gestor da Unidade</option>
                                {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                            <div className="flex justify-end space-x-2">
                                <button type="button" onClick={() => setShowAddUnit(false)} className="bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-md hover:bg-slate-300 transition-colors text-sm">Cancelar</button>
                                <button type="submit" className="bg-green-500 text-white font-bold py-2 px-4 rounded-md hover:bg-green-600 transition-colors text-sm">Salvar</button>
                            </div>
                        </form>
                    )}
                    {editingUnit && (
                        <form onSubmit={handleUnitEditSubmit} className="bg-slate-50 p-4 rounded-lg border border-blue-200 mb-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-slate-700">Editar unidade</h4>
                                <button type="button" onClick={cancelUnitEdit} className="text-xs text-slate-500 hover:underline">Cancelar</button>
                            </div>
                            <input
                                type="text"
                                placeholder="Nome da Unidade"
                                value={editUnitName}
                                onChange={e => setEditUnitName(e.target.value)}
                                required
                                className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <select
                                value={editUnitManagerId}
                                onChange={e => setEditUnitManagerId(e.target.value)}
                                required
                                className="w-full bg-white border border-slate-300 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Selecione o Gestor da Unidade</option>
                                {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                            <div className="flex justify-end space-x-2">
                                <button type="submit" className="bg-blue-500 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-600 transition-colors text-sm">Atualizar</button>
                            </div>
                        </form>
                    )}
                    <ul className="divide-y divide-slate-200">
                        {units.map(u => (
                            <li key={u.id} className="flex items-center justify-between p-2">
                                <div>
                                    <div className="font-medium">{u.name} {u.active === false && <span className="text-xs text-red-500 ml-2">(Desativada)</span>}</div>
                                    <div className="text-sm text-slate-500">Gestor: {users.find(user => user.id === u.managerId)?.name}</div>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button onClick={async () => {
                                        if (typeof onUnitUpdate === 'function') {
                                            onUnitUpdate(u.id, { active: !(u.active ?? true) });
                                        }
                                    }} className={`py-1 px-2 text-sm rounded-md ${u.active === false ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                                        {u.active === false ? 'Ativar' : 'Desativar'}
                                    </button>
                                    <button onClick={() => openUnitEditForm(u)} className="py-1 px-2 bg-blue-500 text-white text-sm rounded-md">Editar</button>
                                    <button onClick={async () => {
                                        if (window.confirm(`Excluir unidade ${u.name}? Esta ação é irreversível.`)) {
                                            if (typeof onUnitDelete === 'function') {
                                                onUnitDelete(u.id);
                                            }
                                        }
                                    }} className="py-1 px-2 bg-red-100 text-red-700 text-sm rounded-md">Excluir</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            {/* AUDIT LOG */}
            <div className="mt-6 bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-xl font-semibold mb-4 text-slate-600">Log de Auditoria</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                             <tr className="border-b bg-slate-50">
                                <th className="p-3">Data</th>
                                <th className="p-3">Usuário</th>
                                <th className="p-3">Ação</th>
                                <th className="p-3">Detalhes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {auditLog.map(log => {
                                const performingUser = users.find(u => u.id === log.performingUserId);
                                return (
                                <tr key={log.id} className="border-b hover:bg-slate-50 text-sm">
                                    <td className="p-3 text-slate-500">{new Date(log.timestamp).toLocaleString()}</td>
                                    <td className="p-3 font-medium text-slate-800">{performingUser?.name ?? 'Sistema'}</td>
                                    <td className="p-3"><span className="bg-slate-200 text-slate-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">{log.action}</span></td>
                                    <td className="p-3 text-slate-600">{log.details}</td>
                                </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    {auditLog.length === 0 && <p className="text-center text-slate-500 py-8">Nenhuma atividade registrada.</p>}
                </div>
            </div>
        </div>
    );
};


interface NotificationsViewProps {
  notifications: Notification[];
  markAsRead: (id: string) => Promise<void>;
}
const NotificationsView: React.FC<NotificationsViewProps> = ({ notifications, markAsRead }) => {
    
    const handleMarkAsRead = async (id: string) => {
        try {
            await markAsRead(id);
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 text-slate-700">Notificações</h2>
            <div className="bg-white rounded-lg shadow-md">
                {notifications.length === 0 && <p className="text-center text-slate-500 p-8">Nenhuma notificação.</p>}
                <ul className="divide-y divide-slate-200">
                    {notifications.map(n => (
                        <li key={n.id} className={`p-4 flex items-start space-x-4 ${n.read ? 'opacity-60' : 'bg-blue-50'}`}>
                            <div className="flex-shrink-0">
                                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${n.read ? 'bg-slate-300' : 'bg-red-500'}`}>
                                    <span className="text-white font-bold text-lg">!</span>
                                </div>
                            </div>
                            <div className="flex-1">
                                <p className="text-slate-700">{n.message}</p>
                                <p className="text-sm text-slate-500 mt-1">{new Date(n.timestamp).toLocaleString()}</p>
                            </div>
                            {!n.read && (
                                <button onClick={() => handleMarkAsRead(n.id)} className="text-sm text-blue-500 hover:underline whitespace-nowrap">Marcar como lida</button>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};


export default App;
