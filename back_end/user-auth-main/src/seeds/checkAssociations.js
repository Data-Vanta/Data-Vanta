const sequelize = require('../config/database');
const Role = require('../api/role/role.model');
const Permission = require('../api/permission/permission.model');
// load join model so associations set up
require('../api/role/rolePermission.model');

async function runCheck() {
  try {
    await sequelize.authenticate();
    // make sure all tables and association tables exist before test
    await sequelize.sync({ alter: true });

    // Create temporary entries
    const [role] = await Role.findOrCreate({ where: { name: '__TEST_ROLE__' } });
    const [perm1] = await Permission.findOrCreate({ where: { name: '__TEST_PERM_A__' } });
    const [perm2] = await Permission.findOrCreate({ where: { name: '__TEST_PERM_B__' } });

    // Add multiple permissions
    await role.setPermissions([perm1, perm2]);

    // Reload and include permissions
    const r = await Role.findByPk(role.role_id, { include: [{ model: Permission, through: { attributes: [] } }] });

    if (r && r.Permissions && r.Permissions.length >= 2) {
      console.log('Association check passed — Role has permissions attached.');
      // cleanup
      await role.setPermissions([]);
      await perm1.destroy();
      await perm2.destroy();
      await role.destroy();
      process.exit(0);
    }

    console.error('Association check failed — expected attached permissions.');
    process.exit(2);
  } catch (err) {
    console.error('Association check error:', err);
    process.exit(1);
  }
}

runCheck();
