const jwt = require('jsonwebtoken');
const Mailer = require('../../utils/mailer');
const bcryptUtil = require('../../utils/bcrypt');
const UserRepository = require('../user/user.repository');

// Helper function to sign JWT tokens
const signToken = (payload, expiresIn = '1d') => {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

class AuthService {
    constructor() {
        this.userRepository = UserRepository;
        this.mailer = new Mailer();
    }

    /**
     * Handles user registration.
     * @param {object} userData - User data from the request.
     * @returns {object} The new user object.
     */
    async signup(userData) {
        const { email, password } = userData;

        const isExist = await this.userRepository.findByEmail(email);
        if (isExist) {
            throw { statusCode: 409, message: "Email already exists" };
        }

        userData.password = await bcryptUtil.hashPassword(password);
        // Explicit opt-in: only auto-verify + skip mail when AUTO_VERIFY_USERS=true.
        // Hard-block this in production even if the flag is set — refuses to
        // silently trust signups on prod if env is misconfigured.
        const autoVerify = process.env.AUTO_VERIFY_USERS === 'true';
        if (autoVerify && process.env.NODE_ENV === 'production') {
            throw {
                statusCode: 500,
                message: 'AUTO_VERIFY_USERS is forbidden in production. Unset this variable.',
            };
        }
        if (autoVerify) {
            userData.isVerified = true;
        }
        const newUser = await this.userRepository.create(userData);

        if (!autoVerify) {
            const verificationToken = signToken({ userId: newUser.id });
            const verificationLink = `${process.env.URL}/api/v1/auth/verify-email?token=${verificationToken}`;
            await this.mailer.sendVerificationEmail(email, verificationLink);
        }

        newUser.password = undefined;
        return newUser;
    }

    /**
     * Re-sends the verification email for an authenticated (but unverified) user.
     * @param {object} user - The user from validateAuth middleware.
     */
    async resendVerification(user) {
        if (!user) throw { statusCode: 401, message: 'Not authenticated' };
        if (user.isVerified) {
            return { alreadyVerified: true };
        }
        const verificationToken = signToken({ userId: user.id });
        const verificationLink = `${process.env.URL}/api/v1/auth/verify-email?token=${verificationToken}`;
        await this.mailer.sendVerificationEmail(user.email, verificationLink);
        return { alreadyVerified: false };
    }

    /**
     * Verifies a user's email address.
     * @param {string} token - The verification token.
     */
    async verifyEmail(token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        await this.userRepository.verifyEmail(decoded.userId);
    }

    /**
     * Handles user sign-in.
     * @param {string} email - The user's email.
     * @param {string} password - The user's password.
     * @returns {object} - { token, user }
     */
    async signin(email, password) {
        // We need the password here, so we call a special repository method
        const user = await this.userRepository.findByEmailWithPassword(email);
        if (!user) {
            throw { statusCode: 401, message: "Invalid credentials" };
        }

        const isMatch = await bcryptUtil.comparePassword(password, user.password);
        if (!isMatch) {
            throw { statusCode: 401, message: "Invalid credentials" };
        }

        const token = signToken({ userId: user.id, role: user.role });
        user.password = undefined;

        return { token, user };
    }

    /**
     * Initiates the password reset process.
     * @param {string} email - The user's email.
     */
    async forgetPassword(email) {
        if (!email) throw { statusCode: 400, message: "Email is required" };

        const user = await this.userRepository.findByEmail(email);
        if (!user) throw { statusCode: 404, message: "User not found" };

        const resetToken = signToken({ userId: user.id }, '10m'); // Short-lived token
        const validFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const resetLink = `${validFrontendUrl}/reset-password?token=${resetToken}`;
        await this.mailer.sendPasswordResetEmail(email, resetLink);
    }

    /**
     * Completes the password change process.
     * @param {string} token - The password reset token.
     * @param {string} newPassword - The new password.
     */
    async changePassword(token, newPassword) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const hashedPassword = await bcryptUtil.hashPassword(newPassword);

        // Use a dedicated repository method for security
        await this.userRepository.updatePassword(decoded.userId, hashedPassword);
    }
}

module.exports = AuthService;