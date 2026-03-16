# FleetConnect Backend

Backend FastAPI securise pour l'application de flotte telephonique.

## Structure

```text
backend/
  alembic/
    env.py
    versions/
      0001_initial_schema.py
  app/
    api/
      router.py
      routes/
        auth.py
        health.py
        phone_lines.py
        users.py
    core/
      config.py
      dependencies.py
      exceptions.py
      logging.py
      middleware.py
      rate_limit.py
      security.py
    db/
      base.py
      session.py
    models/
      phone_line.py
      user.py
    schemas/
      auth.py
      common.py
      phone_line.py
      user.py
    services/
      auth_service.py
      phone_line_service.py
      user_service.py
    main.py
  tests/
    api/
      test_auth_security.py
    services/
      test_phone_line_service.py
    conftest.py
  .env
  .env.example
  alembic.ini
  pyproject.toml
```

## Fichiers securite

- `app/core/config.py` : charge les secrets et options depuis `.env` avec `pydantic-settings`.
- `app/core/security.py` : hash des mots de passe, JWT access/refresh et scheme OAuth2.
- `app/core/dependencies.py` : dependances reutilisables `current_user`, `current_active_user`, `admin_user` et controle d'acces objet.
- `app/core/rate_limit.py` : rate limiting en memoire pour les endpoints sensibles.
- `app/core/middleware.py` : CORS, trusted hosts, redirection HTTPS optionnelle et headers de securite.
- `app/core/exceptions.py` : handlers propres pour 429 et erreurs internes.
- `app/core/logging.py` : configuration du logging et helpers pour masquer les emails dans les logs.
- `app/services/auth_service.py` : authentification, verification des tokens, RBAC admin et rotation simple access/refresh.
- `app/api/routes/auth.py` : endpoints `login`, `token`, `refresh`, `me`.

## Entites

- `User` : utilisateur authentifiable avec role, statut actif, `last_login_at`.
- `PhoneLine` : exemple CRUD securise et pagine pour demontrer l'architecture.

## Base de donnees

Configuration locale actuelle :

- host : `localhost`
- port : `5432`
- database : `flotte_telephonique`
- user : `postgres`
- password : `ilham123`
- schema : `public`

L'URL attendue en local :

```text
postgresql+psycopg2://postgres:ilham123@localhost:5432/flotte_telephonique
```

## Installation

```powershell
cd C:\Users\Microsoft\Desktop\flotte_telephonique\backend
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install -e ".[dev]"
```

## Commandes

### Lancer l'application

```powershell
cd C:\Users\Microsoft\Desktop\flotte_telephonique\backend
.\venv\Scripts\python.exe -m alembic upgrade head
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

### Lint Ruff

```powershell
cd C:\Users\Microsoft\Desktop\flotte_telephonique\backend
.\venv\Scripts\python.exe -m ruff check .
```

### Format Ruff

```powershell
cd C:\Users\Microsoft\Desktop\flotte_telephonique\backend
.\venv\Scripts\python.exe -m ruff format .
```

### Tests Pytest

```powershell
cd C:\Users\Microsoft\Desktop\flotte_telephonique\backend
.\venv\Scripts\python.exe -m pytest
```

### Creer une migration

```powershell
cd C:\Users\Microsoft\Desktop\flotte_telephonique\backend
.\venv\Scripts\python.exe -m alembic revision --autogenerate -m "describe change"
```

### Appliquer les migrations

```powershell
cd C:\Users\Microsoft\Desktop\flotte_telephonique\backend
.\venv\Scripts\python.exe -m alembic upgrade head
```

## API principale

- `POST /api/v1/auth/login` : login JSON pour le frontend React
- `POST /api/v1/auth/token` : login OAuth2 password flow pour Swagger/clients standards
- `POST /api/v1/auth/refresh` : emission d'un nouveau couple access/refresh token
- `GET /api/v1/auth/me` : utilisateur courant
- `GET /api/v1/users/` : liste paginee, admin uniquement
- `GET /api/v1/users/{user_id}` : acces a soi-meme ou admin
- `POST /api/v1/users/` : création d'utilisateur, admin uniquement
- `GET /api/v1/phone-lines/` : liste paginee, utilisateur authentifie
- `POST /api/v1/phone-lines/` : creation, admin uniquement

## Notes frontend

- Le frontend React peut continuer a utiliser `POST /api/v1/auth/login` avec JSON.
- La reponse contient maintenant `refresh_token` en plus de `access_token`.
- Le stockage `localStorage` continue de fonctionner, mais pour un niveau de securite superieur il faut envisager des cookies `HttpOnly`, `Secure` et `SameSite=Lax/Strict`.

## Compte admin par defaut

- email : `admin@bcskills.ma`
- password : `Admin123!`

Change ces valeurs dans `.env` avant un usage reel.
