/**
 * Inspect / set / clear users.avatar — used to verify Cloudinary uploads and
 * to restore a test account's avatar afterwards.
 *
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/avatar.ts <userId>
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/avatar.ts <userId> clear
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/avatar.ts <userId> set <value>
 */
import 'dotenv/config';
import { dataSourceOptions } from '../../config/typeorm.datasource';
import { DataSource } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';

async function main() {
  const [userId, action, value] = process.argv.slice(2);
  if (!userId) {
    console.error('Usage: avatar.ts <userId> [clear|set <value>]');
    process.exit(1);
  }
  const ds = new DataSource(dataSourceOptions);
  await ds.initialize();
  try {
    const users = ds.getRepository(UserEntity);
    const user = await users.findOne({ where: { id: userId } });
    if (!user) {
      console.log('USER-NOT-FOUND');
      process.exit(1);
    }
    if (!action) {
      console.log(`avatar=${JSON.stringify(user.avatar ?? null)}`);
      process.exit(0);
    }
    const next = action === 'clear' ? null : action === 'set' ? (value ?? null) : null;
    await users.update({ id: userId }, { avatar: next as any });
    console.log(`avatar set to ${JSON.stringify(next)}`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
