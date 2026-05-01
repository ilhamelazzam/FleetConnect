# TODO: Améliorer interface page "Lignes" pour occupation claire
Statut: [✅] Backend schemas/services partiel (1.1 ✅, 1.2 partial)

## Plan approuvé breakdown (Priorité: backend → frontend)

### 1. Backend - Ajouter support occupation status (services/schemas/routes)
   [✅ **1.1**] Edit backend/app/schemas/phone_line.py: PhoneLineOccupationStatus + field ✅
   [✅ **1.2**] Edit backend/app/services/phone_line_service.py: compute_occupation_status, list_with_filters, get_occupation_stats ✅
   [✅ **1.3**] Edit backend/app/api/routes/phone_lines.py: /stats/occupation + filters on / ✅

### 2. Frontend - Switch PhoneLines.tsx à phoneLinesApi + UI occupation
[✅ **2.1**] Update frontend/src/app/lib/api.ts: occupation_status + occupationStats ✅
   [ ] **2.2** Major refactor frontend/src/app/pages/PhoneLines.tsx.
   [ ] **2.3** Minor drawer.
   [ ] **2.3** Minor drawer.

### 3. Tests & Polish
   [ ] Test.

## Prochaines étapes
- 1.3 routes phone_lines.py
- Test backend.

*Note: Pylance ignore, no impact.*

