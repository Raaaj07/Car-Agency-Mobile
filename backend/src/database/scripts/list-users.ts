/**
 * List recent user accounts (phone/name/role/status) — quick account inventory.
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/list-users.ts
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../config/typeorm.datasource';
import { UserEntity } from '../../auth/entities/user.entity';

async function main() {
  const ds = new DataSource(dataSourceOptions);
  await ds.initialize();
  try {
    const rows = await ds
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .select(['u.id', 'u.phone', 'u.name', 'u.role'])
      .orderBy('u.createdAt', 'DESC')
      .limit(20)
      .getMany();
    console.log(`users: ${rows.length}`);
    for (const u of rows) {
      console.log(`- phone=${u.phone}  role=${u.role}  name=${u.name}`);
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
