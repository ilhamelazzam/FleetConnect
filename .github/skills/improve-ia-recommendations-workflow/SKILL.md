---
name: improve-ia-recommendations-workflow
description: "Use when improving an AI recommendation workflow on a dashboard page, including button/modal/toast states, post-action status panels, and business-coherent messaging."
---

# Improve IA Recommendations Workflow

This skill captures a repeatable frontend improvement workflow for the "Appliquer toutes les recommandations IA" experience.
It focuses on making the sequence more intuitive, business-coherent, and visually clear while preserving existing functionality.

## When to use
- You need to improve a dashboard action workflow that launches AI recommendations and confirms results.
- The current flow uses a confirmation modal, toast notification, and a persistent status block.
- You want clearer labels for pre-action, launching, success, and persistent active state.
- You want to enrich the post-action status card with summary metrics and action links.

## Goal
Deliver a cleaner UX for the AI recommendations workflow with:
- clearly named states
- a button that no longer looks like the initial action after execution
- a more professional success toast
- an enriched persistent status block with details and actions
- consistent business language across button, modal, toast, and status panel

## Workflow steps

1. Review the target page/component
   - Locate the page or component that renders the "Appliquer toutes les recommandations IA" button.
   - Identify the confirmation modal, toast call, and persistent status panel.
   - Confirm the current state variables and API action flow.

2. Define the state machine
   - `idle` / pre-action: label is `Appliquer toutes les recommandations IA`.
   - `pending` / launched: label becomes `Automatisation lancée` and the button enters a temporary disabled state.
   - `success` / executed: label becomes `Recommandations IA appliquées` or `Automatisation active`.
   - `active` / persistent page state: show `Automatisation IA active` in the status block.

3. Rename and harmonize labels
   - Button text: use explicit state labels instead of reusing the initial action.
   - Modal header/description: explain the operation and confirm the launch.
   - Toast text: summarize results professionally, e.g.:
     "Recommandations IA appliquées avec succès. 6 forfaits ajustés sur 289 lignes. Gain estimé : 60 942 MAD."
   - Status block: use the same business narrative and avoid conflicting wording.

4. Update the button behavior
   - After confirmation, switch to a launching/disabled state.
   - On success, update the button label to a non-action state.
   - Prefer `disabled` or secondary style to show the action is completed.
   - If possible, keep a secondary action like `Voir le détail` nearby instead of re-enabling the main CTA.

5. Enrich the persistent status panel
   - Include:
     - last application date/time
     - forfaits ajustés count
     - lignes impactées count
     - gain estimé
   - Optionally keep secondary indicators if they remain visually clean.
   - Add useful actions with clear labels:
     - `Voir le détail`
     - `Consulter les forfaits ajustés`
   - Only add `Annuler`/`Réinitialiser` if the business logic supports rollback.

6. Keep the visual design professional
   - Preserve the current modern, sobre BC SKILLS theme.
   - Use the existing card/modal/toast styles.
   - Avoid adding new visual patterns that conflict with the dashboard.

7. Validate behavior
   - Ensure the AI recommendation API call still works.
   - Preserve modal confirmation flow.
   - Keep existing success/failure handling intact.
   - Verify the new persistent block shows data only after successful execution.

## Completion checks
- [ ] The main button has distinct labels for idle, launching, and completed states.
- [ ] The confirmation modal wording is aligned with the action.
- [ ] The success toast includes metrics and reads professionally.
- [ ] The green status block shows last run time, metrics, and linked actions.
- [ ] The workflow text is coherent across button/modal/toast/status.
- [ ] The design remains modern and consistent with the BC SKILLS theme.
- [ ] Existing functionality is preserved.

## Example prompt
"Améliore le workflow du bouton `Appliquer toutes les recommandations IA` sur la page Forfaits pour que le bouton, la modale, le toast et le bloc vert racontent une seule logique métier cohérente."
