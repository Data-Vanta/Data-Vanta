const sequelize = require('../config/database');
const Role = require('../api/role/role.model');
const Permission = require('../api/permission/permission.model');
// ensure role-permission join model is loaded so associations exist
require('../api/role/rolePermission.model');

async function seed() {
  try {
    await sequelize.authenticate();
    // Ensure tables exist before seeding join table data
    await sequelize.sync({ alter: true });

    // All team-related permissions
    const permissions = [
      'team_view',
      'team_update',
      'team_delete',
      'member_add',
      'member_remove',
      'member_role_update',
    ];

    const createdPerms = [];
    for (const name of permissions) {
      const [perm] = await Permission.findOrCreate({ where: { name } });
      createdPerms.push(perm);
    }

    // Create Owner role with ALL permissions
    const [ownerRole] = await Role.findOrCreate({ where: { name: 'Owner' } });
    await ownerRole.setPermissions(createdPerms);
    console.log('Owner role created with all permissions');

    // Create Admin role with most permissions (except team_delete)
    const adminPerms = createdPerms.filter(p => p.name !== 'team_delete');
    const [adminRole] = await Role.findOrCreate({ where: { name: 'Admin' } });
    await adminRole.setPermissions(adminPerms);
    console.log('Admin role created with admin permissions');

    // Create Member role with view only
    const memberPerms = createdPerms.filter(p => p.name === 'team_view');
    const [memberRole] = await Role.findOrCreate({ where: { name: 'Member' } });
    await memberRole.setPermissions(memberPerms);
    console.log('Member role created with view permission');

    // Create Viewer role with view only
    const [viewerRole] = await Role.findOrCreate({ where: { name: 'Viewer' } });
    await viewerRole.setPermissions(memberPerms);
    console.log('Viewer role created with view permission');

    console.log('Seeding complete: roles and permissions created and associated.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
