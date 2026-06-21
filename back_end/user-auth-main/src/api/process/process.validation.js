const Joi = require('joi');

// Schema to validate the request body for the handleMissingValues endpoint
const handleMissingValuesSchema = Joi.object({
  column: Joi.string().required().messages({
    'string.empty': 'Column name is required.',
    'any.required': 'Column name is required.'
  }),
  strategy: Joi.string().valid('drop', 'mean', 'median', 'mode', 'fill').required().messages({
    'any.only': 'Strategy must be one of [drop, mean, median, mode, fill].',
    'any.required': 'Strategy is required.'
  }),
  // 'fillValue' is only allowed and required when the strategy is 'fill'
  fillValue: Joi.any().when('strategy', {
    is: 'fill',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }).messages({
    'any.required': 'A fillValue is required when using the "fill" strategy.'
  })
});

module.exports = {
  handleMissingValuesSchema
};
