require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  verifyToken: process.env.VERIFY_TOKEN || '',
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  adminNotificationNumber: process.env.ADMIN_NOTIFICATION_NUMBER || '',
  managerNotificationNumber:
    process.env.MANAGER_NOTIFICATION_NUMBER ||
    process.env.ADMIN_NOTIFICATION_NUMBER ||
    '',
  dataDir: process.env.DATA_DIR || './data',
  companyName: process.env.COMPANY_NAME || 'Gestion de Vacaciones',
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '591',
  baseUrl: process.env.BASE_URL || '',
  tempDir: process.env.TMP_DIR || '/tmp',

  luranaTokenUrl: process.env.LURANA_TOKEN_URL || '',
  luranaClientId: process.env.LURANA_CLIENT_ID || '',
  luranaClientSecret: process.env.LURANA_CLIENT_SECRET || '',
  luranaUser: process.env.LURANA_USER || '',
  luranaPassword: process.env.LURANA_PASSWORD || '',
  luranaScope: process.env.LURANA_SCOPE || '*',

  luranaApiBaseUrl: process.env.LURANA_API_BASE_URL || '',
  luranaWorkspace: process.env.LURANA_WORKSPACE || '',
  luranaProUid: process.env.LURANA_PRO_UID || '',
  luranaTasUid: process.env.LURANA_TAS_UID || '',
  luranaCertInpDocUid: process.env.LURANA_CERT_INP_DOC_UID || '',
  luranaPhoneLookupPaths:
    process.env.LURANA_PHONE_LOOKUP_PATHS ||
    'plugin-PsManagementTools/getUserDataByPhone/{phone},plugin-PsManagementTools/getUserData/{phone}'
};
