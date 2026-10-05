/**
 * One-off admin utility: convert a rider account into a driver account.
 *
 *   inspect : npx ts-node -r tsconfig-paths/register src/database/scripts/convert-to-driver.ts <phone>
 *   apply   : npx ts-node -r tsconfig-paths/register src/database/scripts/convert-to-driver.ts <phone> apply [--pending]
 *
 * What "being a driver" means in this codebase:
 *   - users.role          -> 'driver' (matches how seed.ts models drivers; the
 *                            socket gateway only joins user:<id> rooms, and
 *                            driver permission never comes from this claim)
 *   - drivers.status      -> 'approved' (ApprovedDriverGuard + ProfileScreen's
 *                            Rider/Driver mode toggle both read this column,
 *                            via /auth/me -> driverStatus)
 *   - Drivers row is created if the user never applied (vehicle fields are
 *     NOT NULL on the entity).
 *
 * Default is direct approval; pass --pending to create the application in
 * 'pending' state instead (then approve it from the admin console).
 */
import 'reflect-metadata';
import { DataSource, ILike } from 'typeorm';
import { dataSourceOptions } from '../../config/typeorm.datasource';
import { UserEntity } from '../../auth/entities/user.entity';
import { DriverEntity, VehicleType } from '../../drivers/entities/driver.entity';

type Args = { phone: string; apply: boolean; pending: boolean };

function parseArgs(): Args {
  const rest = process.argv.slice(2);
  const phone = rest.find((a) => !a.startsWith('--'));
  return {
    phone: phone ?? '6383462213',
    apply: rest.includes('apply'),
    pending: rest.includes('--pending'),
  };
}

async function main(): Promise<void> {
  const { phone, apply, pending } = parseArgs();

  const ds = new DataSource(dataSourceOptions);
  await ds.initialize();
  const users = ds.getRepository(UserEntity);
  const drivers = ds.getRepository(DriverEntity);

  try {
    // Phone may be stored with a country code prefix/suffix variants.
    const user =
      (await users.findOne({ where: { phone } })) ??
      (await users.findOne({ where: { phone: ILike(`%${phone}`) } })) ??
      (await users.findOne({ where: { phone: ILike(`${phone}%`) } }));

    if (!user) {
      console.log(`No user found for phone "${phone}".`);
      return;
    }

    const existing = await drivers.findOne({ where: { userId: user.id } });

    console.log('--- current state ------------------------------------');
    console.log(`user   : id=${user.id} name="${user.name}" phone=${user.phone} role=${user.role} active=${user.isActive}`);
    console.log(
      existing
        ? `driver : id=${existing.id} status=${existing.status} vehicleType=${existing.vehicleType} carModel=${existing.carModel} plate=${existing.plateNumber} online=${existing.isOnline} available=${existing.isAvailable}`
        : 'driver : (no drivers row yet)',
    );

    if (!apply) {
      console.log('\n(inspect only — pass "apply" to convert this account)');
      return;
    }

    // 1. users.role -> 'driver'
    if (user.role !== 'driver') {
      user.role = 'driver';
      await users.save(user);
    }

    // 2. ensure an approved drivers row
    const status = pending ? 'pending' : 'approved';
    let driver: DriverEntity;
    if (existing) {
      existing.status = status as DriverEntity['status'];
      if (!pending) {
        existing.rejectionReason = null;
        existing.reviewedAt = new Date();
      }
      driver = await drivers.save(existing);
    } else {
      driver = await drivers.save(
        drivers.create({
          userId: user.id,
          // NOT NULL placeholders — the user can only change these via a new
          // application, so keep them obviously editable defaults.
          vehicleType: 'sedan' as VehicleType,
          carModel: 'To be updated',
          plateNumber: 'PENDING',
          status: status as DriverEntity['status'],
          submittedAt: new Date(),
          reviewedAt: pending ? null : new Date(),
          isOnline: false,
          isAvailable: false,
        }),
      );
    }

    console.log('--- after ------------------------------------------------');
    console.log(`user   : role=${user.role}`);
    console.log(
      `driver : id=${driver.id} status=${driver.status} vehicleType=${driver.vehicleType} carModel=${driver.carModel} plate=${driver.plateNumber}`,
    );
    console.log(
      pending
        ? '\nDONE (pending): approve it from the admin console to enable driver mode.'
        : '\nDONE: the account can now switch to driver mode (Profile > Switch to Driver) and go online.',
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
