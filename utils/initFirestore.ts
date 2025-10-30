import { User, Unit, ChecklistTemplate, UserRole } from '../types.ts';
import { usersService, unitsService, templatesService } from '../services/firestore.ts';

// Dados iniciais para popular o Firestore
const INITIAL_USERS: Omit<User, 'id'>[] = [
  { name: 'Ana Silva', email: 'ana.silva@example.com', role: UserRole.MANAGER, managerId: undefined },
  { name: 'Carlos Dias', email: 'carlos.dias@example.com', role: UserRole.MANAGER, managerId: undefined },
  { name: 'Alysson Krombauer', email: 'alysson@ambiental.sc', role: UserRole.MANAGER, managerId: undefined },
  { name: 'Mariana Costa', email: 'mariana.coordenador@example.com', role: UserRole.COORDINATOR, managerId: undefined },
];

const INITIAL_TEMPLATES: Omit<ChecklistTemplate, 'id'>[] = [
  {
    name: 'Inspeção Mensal de Extintores',
    items: [
      { id: 'item-1-1', text: 'O acesso ao extintor está desobstruído?' },
      { id: 'item-1-2', text: 'O lacre está intacto?' },
      { id: 'item-1-3', text: 'O manômetro indica pressão correta (faixa verde)?' },
      { id: 'item-1-4', text: 'A mangueira e o bico estão em boas condições?' },
      { id: 'item-1-5', text: 'A data de validade da carga está em dia?' },
    ],
  },
  {
    name: 'Verificação de Equipamentos de Proteção Individual (EPI)',
    items: [
      { id: 'item-2-1', text: 'Os capacetes estão sem rachaduras ou danos?' },
      { id: 'item-2-2', text: 'As luvas de proteção estão em bom estado?' },
      { id: 'item-2-3', text: 'Os óculos de segurança estão limpos e sem riscos?' },
      { id: 'item-2-4', text: 'Os calçados de segurança estão adequados?' },
    ],
  },
];

export async function initializeFirestore() {
  try {
    console.log('Inicializando dados no Firestore...');

    // Verificar se já existem usuários
    const existingUsers = await usersService.getAll();
    if (existingUsers.length === 0) {
      console.log('Criando usuários iniciais...');
      const userPromises = INITIAL_USERS.map(async (user) => {
        const userId = await usersService.add(user);
        return { ...user, id: userId };
      });
      const createdUsers = await Promise.all(userPromises);
      console.log(`${createdUsers.length} usuários criados.`);

      // Atualizar managerId para os managers (self-reference)
      for (const user of createdUsers) {
        if (user.role === UserRole.MANAGER) {
          await usersService.update(user.id, { managerId: user.id });
        }
      }

      // Criar unidades com os managers criados
      const managers = createdUsers.filter(u => u.role === UserRole.MANAGER);
      if (managers.length >= 2) {
        const initialUnits: Omit<Unit, 'id'>[] = [
          { name: 'Filial São Paulo', managerId: managers[0].id },
          { name: 'Filial Rio de Janeiro', managerId: managers[1].id },
        ];

        console.log('Criando unidades iniciais...');
        const unitsPromises = initialUnits.map(unit => unitsService.add(unit));
        await Promise.all(unitsPromises);
        console.log(`${initialUnits.length} unidades criadas.`);
      }
    }

    // Verificar se já existem templates
    const existingTemplates = await templatesService.getAll();
    if (existingTemplates.length === 0) {
      console.log('Criando templates iniciais...');
      const templatesPromises = INITIAL_TEMPLATES.map(template => templatesService.add(template));
      await Promise.all(templatesPromises);
      console.log(`${INITIAL_TEMPLATES.length} templates criados.`);
    }

    console.log('Inicialização do Firestore concluída!');
  } catch (error) {
    console.error('Erro ao inicializar Firestore:', error);
  }
}

// Função para limpar todos os dados (usar com cuidado!)
export async function clearFirestore() {
  try {
    console.log('Limpando dados do Firestore...');
    
    const users = await usersService.getAll();
    const units = await unitsService.getAll();
    const templates = await templatesService.getAll();

    const deletePromises = [
      ...users.map(u => usersService.delete(u.id)),
      ...units.map(u => unitsService.delete(u.id)),
      ...templates.map(t => templatesService.delete(t.id))
    ];

    await Promise.all(deletePromises);
    console.log('Dados limpos do Firestore!');
  } catch (error) {
    console.error('Erro ao limpar Firestore:', error);
  }
}