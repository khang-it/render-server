```
render-server/
├─ package.json
├─ package-lock.json
├─ .env
├─ .env.example
├─ .gitignore
├─ README.md
├─ jsconfig.json
├─ nodemon.json
├─ keys/
│   ├─ localhost.pem
│   └─ localhost-key.pem
├─ certs/
│   └─ ca.pem
├─ logs/
│   └─ app.log
├─ src/
│   ├─ app.js
│   ├─ server.js
│   ├─ db.js
│   ├─ websocket.js
│   │
│   ├─ config/
│   │   ├─ cors.js
│   │   ├─ jwt.js
│   │   └─ upload.js
│   │
│   ├─ middlewares/
│   │   ├─ authBearer.js
│   │   └─ requestLogger.js
│   │
│   ├─ routes/
│   │   ├─ auth.routes.js
│   │   ├─ user.routes.js
│   │   └─ upload.routes.js
│   │
│   ├─ controllers/
│   │   ├─ auth.controller.js
│   │   └─ user.controller.js
│   │
│   ├─ services/
│   │   ├─ token.service.js
│   │   └─ user.service.js
│   │
│   └─ utils/
│       ├─ index.js
│       └─ hash.js


```
