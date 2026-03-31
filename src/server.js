require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  verifyToken: process.env.VERIFY_TOKEN || '',
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  adminNotificationNumber: process.env.ADMIN_NOTIFICATION_NUMBER || '',
  baseUrl: process.env.BASE_URL || '',
  dataDir: process.env.DATA_DIR || './data',
  companyName: process.env.COMPANY_NAME || 'Gestion de Vacaciones',
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '591'
};