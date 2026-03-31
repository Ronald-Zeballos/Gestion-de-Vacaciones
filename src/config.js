require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  verifyToken: process.env.VERIFY_TOKEN || '',
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  adminNotificationNumber: process.env.ADMIN_NOTIFICATION_NUMBER || '',
  dataDir: process.env.DATA_DIR || './data',
  companyName: process.env.COMPANY_NAME || 'Gestion de Vacaciones',
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '591',
  baseUrl: process.env.BASE_URL || '',

  mailHost: process.env.MAIL_HOST || '',
  mailPort: Number(process.env.MAIL_PORT) || 587,
  mailSecure: String(process.env.MAIL_SECURE || 'false') === 'true',
  mailUser: process.env.MAIL_USER || '',
  mailPass: process.env.MAIL_PASS || '',
  mailFrom: process.env.MAIL_FROM || '',
  mailTo: process.env.MAIL_TO || ''
};