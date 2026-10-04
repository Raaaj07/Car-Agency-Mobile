/**
 * List every admin account (and optionally promote one) in the users table.
 *
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/list-admins.ts
 *   npx ts-node -r tsconfig-paths/register src/database/scripts/list-admins.ts <10-digit-phone>
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../config/typeorm.datasource';
import { UserEntity } from '../../auth/entities/user.entity';

async function main() {
  const promotePhone = process.argv[2];
  const ds = new DataSource(dataSourceOptions);
  await ds.initialize();
  try {
    const users = ds.getRepository(UserEntity);

    if (promotePhone) {
      const digits = promotePhone.replace(/\D/g, '').slice(-10);
      const user = await users
        .createQueryBuilder('u')
        .where("RIGHT(REGEXP_REPLACE(u.phone, '\\D', '', 'g'), 10) = :digits", { digits })
        .getOne();
      if (!user) {
        console.log(`NO-USER-FOR-PHONE ${digits} — log in with it once (OTP), then re-run.`);
        process.exit(2);
      }
      await users.update({ id: user.id }, { role: 'admin' as any });
      console.log(`PROMOTED ${user.phone} (${user.name}) -> admin  [id=${user.id}]`);
    }

    const admins = await users
      .createQueryBuilder('u')
      .select(['u.id', 'u.phone', 'u.name', 'u.role', 'u.profileComplete'])
      .where("u.role = 'admin'")
      .getMany();
    console.log(`admin count: ${admins.length}`);
    for (const a of admins) {
      console.log(`- phone=${a.phone}  name=${a.name}  id=${a.id}`);
    }
    if (admins.length === 0) console.log('(none — run with a phone arg to promote, or set ADMIN_PHONES in .env)');
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
