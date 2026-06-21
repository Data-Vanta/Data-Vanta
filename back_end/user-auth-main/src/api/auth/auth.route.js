const express = require("express");
const router = express.Router();
const authController = require("./auth.controller");
const validate = require('../../middlewares/validate');
const { signupSchema, signinSchema, changePasswordSchema } = require("./auth.validation");
const { validateAuth, validateAuthAllowUnverified } = require('../../middlewares/auth.middleware');

// Routes are simpler now, e.g., POST /api/v1/auth/signup
router.post("/signup", validate(signupSchema), authController.signup);
router.post("/signin", validate(signinSchema), authController.signin);

router.get("/verify-email", authController.verifyEmail);

router.post("/forget-password", authController.forgetPassword);
router.get("/reset-password", authController.showResetPasswordForm);
router.post("/change-password", validate(changePasswordSchema), authController.changePassword);

router.get("/me", validateAuth, authController.getMe);
router.post("/resend-verification", validateAuthAllowUnverified, authController.resendVerification);

module.exports = router;