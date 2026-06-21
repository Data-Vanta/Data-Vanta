/**
 * Migration script to fix existing team members' role permissions
 * This ensures teams created BEFORE seeding get proper permissions
 * 
 * Run with: node src/migrations/fixTeamPermissions.js
 */

const sequelize = require('../config/database');
const Role = require('../api/role/role.model');
const Permission = require('../api/permission/permission.model');
const { TeamMember } = require('../api/team/teamMember.model');

// Ensure role-permission join model is loaded
require('../api/role/rolePermission.model');

async function fixTeamPermissions() {
    try {
        await sequelize.authenticate();
        console.log('Connected to database.');

        // First ensure all permissions exist
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
        console.log(`Ensured ${createdPerms.length} permissions exist.`);

        // Find or update Owner role with all permissions
        const [ownerRole] = await Role.findOrCreate({ where: { name: 'Owner' } });
        await ownerRole.setPermissions(createdPerms);
        console.log('Owner role updated with all permissions.');

        // Find or update Admin role
        const adminPerms = createdPerms.filter(p => p.name !== 'team_delete');
        const [adminRole] = await Role.findOrCreate({ where: { name: 'Admin' } });
        await adminRole.setPermissions(adminPerms);
        console.log('Admin role updated with admin permissions.');

        // Find or update Member role
        const memberPerms = createdPerms.filter(p => p.name === 'team_view');
        const [memberRole] = await Role.findOrCreate({ where: { name: 'Member' } });
        await memberRole.setPermissions(memberPerms);
        console.log('Member role updated with view permission.');

        // Find or update Viewer role
        const [viewerRole] = await Role.findOrCreate({ where: { name: 'Viewer' } });
        await viewerRole.setPermissions(memberPerms);
        console.log('Viewer role updated with view permission.');

        // Now update any team members with orphan role_ids to use the correct Owner role
        // This handles teams created before proper role seeding
        const teamMembers = await TeamMember.findAll({
            include: [{ model: Role, as: 'role' }]
        });

        let updated = 0;
        for (const member of teamMembers) {
            // If member has a role named "Owner" but it's a different role_id, update to canonical Owner
            if (member.role && member.role.name === 'Owner' && member.role.role_id !== ownerRole.role_id) {
                await member.update({ role_id: ownerRole.role_id });
                updated++;
            }
        }

        if (updated > 0) {
            console.log(`Updated ${updated} team members to use canonical Owner role.`);
        }

        console.log('\\nMigration complete! All team roles should now have correct permissions.');
        console.log('\\nRole permissions summary:');
        console.log('  Owner:', createdPerms.map(p => p.name).join(', '));
        console.log('  Admin:', adminPerms.map(p => p.name).join(', '));
        console.log('  Member:', memberPerms.map(p => p.name).join(', '));
        console.log('  Viewer:', memberPerms.map(p => p.name).join(', '));

        process.exit(0);
    } catch (err) {
        console.error('Migration error:', err);
        process.exit(1);
    }
}

fixTeamPermissions();
