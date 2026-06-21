const Joi = require("joi");

const createTeamSchema = Joi.object({
    name: Joi.string().min(2).max(100).required(),
    description: Joi.string().max(500).optional(),
    roleName: Joi.string().min(2).max(100).optional()
});

const updateTeamSchema = Joi.object({
    name: Joi.string().min(2).max(100).optional(),
    description: Joi.string().max(500).optional()
});

const addMemberSchema = Joi.object({
    email: Joi.string().email().required(),
    roleName: Joi.string().min(1).max(100).required()
});

const updateMemberRoleSchema = Joi.object({
    role_id: Joi.number().integer().min(1).required()
});

module.exports = { 
    createTeamSchema, 
    updateTeamSchema, 
    addMemberSchema, 
    updateMemberRoleSchema 
};