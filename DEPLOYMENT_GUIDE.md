# 🚀 Despliegue de Trigger - Guía Rápida

## 📋 Checklist de Despliegue

### Paso 1: Preparar servidor Node.js en producción
- [ ] Copiar proyecto a servidor de producción
- [ ] Instalar dependencias: `npm install`
- [ ] Configurar `.env` con credenciales de producción
- [ ] Asegurar que el puerto 3000 esté accesible
- [ ] Iniciar servidor: `npm start`

### Paso 2: Configurar firewall/red
- [ ] Permitir conexión entrante en puerto 3000
- [ ] Verificar que ProcessMaker puede alcanzar la URL
- [ ] Probar conectividad: `node test-trigger-prod.js`

### Paso 3: Desplegar trigger en ProcessMaker
- [ ] Copiar contenido de `trigger-simple.php`
- [ ] En ProcessMaker:
  1. Task → Triggers → New
  2. Seleccionar: "After Dynaform Submit"
  3. Pegar código del trigger
  4. Guardar
- [ ] Verificar URL en el trigger: `https://proservices.luranasoft.com:3000/processmaker/trigger-ping`

### Paso 4: Verificar funcionamiento
- [ ] En ProcessMaker, llenar un dynaform
- [ ] Revisar logs de ProcessMaker → buscar `[TRIGGER_SIMPLE]`
- [ ] Revisar logs de Node.js → buscar `[TRIGGER_PING]`
- [ ] Verificar que el mensaje llegó a WhatsApp

---

## 🧪 Scripts de Testing

### Test Local
```bash
npm start
# En otra terminal:
node test-trigger-simple.js
```

### Test Producción
```bash
node test-trigger-prod.js
```

---

## 🔧 URLs Importantes

| Entorno | URL |
|---------|-----|
| ProcessMaker | https://proservices.luranasoft.com/syspasantia/en/lurana/processes/main |
| Node.js (Prod) | https://proservices.luranasoft.com:3000 |
| Trigger Endpoint | https://proservices.luranasoft.com:3000/processmaker/trigger-ping |

---

## ⚠️ Problemas Comunes

### "No se puede conectar al servidor"
1. ¿El servidor Node.js está ejecutándose?
2. ¿El puerto 3000 está abierto?
3. ¿Hay firewall bloqueando?
4. ¿La URL en el trigger es correcta?

### "Error SSL/HTTPS"
Si vas a usar HTTPS (recomendado), necesitas certificados SSL válidos. Considera usar un proxy inverso como Nginx.

### "Timeout"
Aumenta el timeout en el trigger si el servidor es lento:
```php
CURLOPT_TIMEOUT => 30  // Aumenta este valor
```

---

## 📝 Configuración Mínima del .env

```env
PORT=3000
NODE_ENV=production
WHATSAPP_TOKEN=tu_token
WHATSAPP_PHONE_NUMBER_ID=tu_phone_id
VERIFY_TOKEN=tu_verify_token
ADMIN_NOTIFICATION_NUMBER=tu_numero_manager
LURANA_TOKEN_URL=https://...
LURANA_API_BASE_URL=https://...
LURANA_USER=tu_usuario
LURANA_PASSWORD=tu_password
```

---

## ✅ Confirmación de Éxito

Si ves esto en los logs:
```
[TRIGGER_PING] ✅ Recibido ping del trigger PHP
```

¡Significa que tu trigger está funcionando correctamente! 🎉
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa