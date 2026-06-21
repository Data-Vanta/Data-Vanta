const Joi = require("joi");

const createRoleSchema = Joi.object({
    name: Joi.string().min(2).max(50).required()
});

const updateRoleSchema = Joi.object({
    name: Joi.string().min(2).max(50).optional()
});

const addPermissionSchema = Joi.object({
    perm_id: Joi.number().integer().required()
});

const addPermissionsSchema = Joi.object({
    perm_ids: Joi.array().items(Joi.number().integer()).min(1).required()
});

module.exports = { createRoleSchema, updateRoleSchema, addPermissionSchema, addPermissionsSchema };