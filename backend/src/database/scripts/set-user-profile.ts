/**
 * Set a user's display name and mark the profile complete (skips the
 * in-app CompleteProfile gate on next login).
 *
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/set-user-profile.ts <10-digit-phone> <Name...>
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../config/typeorm.datasource';
import { UserEntity } from '../../auth/entities/user.entity';

async function main() {
  const [phoneArg, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ').trim();
  if (!phoneArg || !name) {
    console.error('Usage: set-user-profile.ts <10-digit-phone> <Name...>');
    process.exit(1);
  }
  const digits = phoneArg.replace(/\D/g, '').slice(-10);

  const ds = new DataSource(dataSourceOptions);
  await ds.initialize();
  try {
    const users = ds.getRepository(UserEntity);
    const user = await users
      .createQueryBuilder('u')
      .where("RIGHT(REGEXP_REPLACE(u.phone, '\\D', '', 'g'), 10) = :digits", { digits })
      .getOne();
    if (!user) {
      console.log(`NO-USER-FOR-PHONE ${digits}`);
      process.exit(2);
    }
    await users.update({ id: user.id }, { name, profileComplete: true } as any);
    console.log(`UPDATED phone=${user.phone} -> name="${name}", profileComplete=true, role=${user.role}`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
