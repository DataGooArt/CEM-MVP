/**
 * Seed script — crea la primera organización + usuario admin
 * Uso:
 *   cd backend
 *   dotenv -e ../.env -- npx ts-node prisma/seed.ts
 *
 * Variables de entorno requeridas: DATABASE_URL
 * Opcionales (defaults incluidos):
 *   SEED_ORG_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ORG_NAME    = process.env.SEED_ORG_NAME       || 'Art Comunicaciones AMD';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL     || 'admin@cem.local';
const ADMIN_PASS  = process.env.SEED_ADMIN_PASSWORD  || 'CemAdmin2026!';
const ADMIN_NAME  = process.env.SEED_ADMIN_NAME      || 'Administrador CEM';

async function main() {
  console.log('🌱 Iniciando seed CEM MVP v2...\n');

  // 1. Organización
  let org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: ORG_NAME, sector: 'Ciberseguridad' },
    });
    console.log(`✅ Organización creada: "${org.name}" (${org.id})`);
  } else {
    console.log(`ℹ️  Organización ya existe: "${org.name}" (${org.id})`);
  }

  // 2. Roles por defecto
  const rolesDef = [
    { name: 'admin',      permissions: ['*'],                                                                                                                                                                   isDefault: false },
    { name: 'supervisor', permissions: ['findings:read','findings:write','remediations:write','domains:read','domains:write','reports:read','alerts:read','alerts:write'], isDefault: false },
    { name: 'viewer',     permissions: ['findings:read','remediations:read','domains:read','reports:read','alerts:read'],                                                   isDefault: true  },
  ];

  const roles: Record<string, string> = {};
  for (const def of rolesDef) {
    const existing = await prisma.role.findFirst({ where: { name: def.name, organizationId: org.id } });
    if (!existing) {
      const r = await prisma.role.create({ data: { ...def, organizationId: org.id } });
      roles[def.name] = r.id;
      console.log(`✅ Rol creado: ${def.name} (${r.id})`);
    } else {
      roles[def.name] = existing.id;
      console.log(`ℹ️  Rol ya existe: ${def.name}`);
    }
  }

  // 3. Usuario admin
  const existingUser = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!existingUser) {
    const passwordHash = await bcrypt.hash(ADMIN_PASS, 12);
    const user = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash,
        name: ADMIN_NAME,
        organizationId: org.id,
        roleId: roles['admin'],
      },
    });
    console.log(`\n✅ Usuario admin creado:`);
    console.log(`   Email:    ${user.email}`);
    console.log(`   Password: ${ADMIN_PASS}`);
    console.log(`   ID:       ${user.id}`);
  } else {
    console.log(`\nℹ️  Usuario admin ya existe: ${ADMIN_EMAIL}`);
  }

  // 4. Organización demo (retrocompatibilidad con orgId='org_demo')
  const orgDemo = await prisma.organization.findUnique({ where: { id: 'org_demo' } });
  if (!orgDemo) {
    await prisma.organization.create({
      data: { id: 'org_demo', name: 'Organización Demo', sector: 'Demo' },
    });
    console.log('\n✅ Organización demo creada (id: org_demo)');
  } else {
    console.log('\nℹ️  Organización demo ya existe');
  }

  console.log('\n🎉 Seed completado. Puedes iniciar sesión en http://localhost:5173');
}

main()
  .catch(e => { console.error('❌ Error en seed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
