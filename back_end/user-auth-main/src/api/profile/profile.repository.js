const Profile = require("./profile.model");

class ProfileRepository {
  async create(profileData) {
    return await Profile.create(profileData);
  }

  async findByUserId(userId) {
    return await Profile.findOne({
      where: { userId },
      include: [{
        association: 'user',
        attributes: ['id', 'name', 'email', 'role']
      }]
    });
  }

  async findById(id) {
    const profile = await this.findByUserId(id);
    // Handle case where profile doesn't exist
    if (!profile) {
      return null;
    }
    return await Profile.findByPk(profile.id, {
      include: [{
        association: 'user',
        attributes: ['id', 'name', 'email', 'role']
      }]
    });
  }

  async updateByProifleId(userId, updateData) {
    // First try to find existing profile
    let profile = await this.findByUserId(userId);

    // If no profile exists, create one
    if (!profile) {
      profile = await this.create({ userId, ...updateData });
      return { count: true, profileId: profile.id, created: true };
    }

    // Update existing profile
    const [affectedCount] = await Profile.update(updateData, {
      where: { id: profile.id }
    });
    return { count: (affectedCount > 0), profileId: profile.id, created: false };
  }

  async deleteByProfileId(userId) {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      return 0; // Nothing to delete
    }
    return await Profile.destroy({ where: { id: profile.id } });
  }

  async userHasProfile(userId) {
    const profile = await this.findByUserId(userId);
    return !!profile;
  }
}

module.exports = new ProfileRepository();