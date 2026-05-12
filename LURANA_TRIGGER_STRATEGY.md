# Lurana WhatsApp Review Strategy

## Recommended trigger placement

### 1. Request submission -> notify the director

Place the trigger on:

- Task: `Solicitar Vacaciones/Permisos`
- Event: `After Dynaform Submit`

Why:

- At that point the Dynaform data already exists.
- The bot can receive the case data and send the WhatsApp summary to the director.
- This is exactly what `POST /processmaker/manager-review` is for.

### 2. Director decision -> route the case in Lurana

Do **not** use `After Routing` on `Revisar Solicitud` to set `@@var_action_reviewer`.

Why:

- `After Routing` runs too late.
- The exclusive gateway is evaluated when the task leaves `Revisar Solicitud`.
- If the variable is set only after routing, the gateway already passed.

For the WhatsApp decision flow, the correct expectation is:

1. The bot calls `plugin-PsManagementTools/updatePtoData`
2. Lurana stores:
   - `@@var_action_reviewer`
   - `@@var_action_reviewer_label`
   - `@@var_comments_reviewer` when action is `2` or `3`
3. Lurana completes or derives the current `Revisar Solicitud` task
4. The exclusive gateway routes automatically:
   - `1` -> `RRHH - Validar Solicitud`
   - `2` -> `Correccion de Solicitud`
   - `3` -> `Solicitud Rechazada`

## What this means in practice

### If `updatePtoData` already routes the case

No extra trigger is needed after the director answers on WhatsApp.

### If `updatePtoData` only updates variables

Then the missing piece is **not** an `After Routing` trigger.

The missing piece is one of these:

- Enhance `plugin-PsManagementTools/updatePtoData` so it also derives the open `Revisar Solicitud` task
- Create a second custom API in Lurana that routes the case after the variables are updated

## Optional manual fallback

If directors may still resolve cases from the Lurana UI, an optional trigger can be added here:

- Task: `Revisar Solicitud`
- Event: `Before Routing`

Use it only to normalize variables or comments before the gateway runs.

Example use cases:

- Ensure `@@var_action_reviewer` is numeric
- Ensure `@@var_action_reviewer_label` is filled
- Ensure `@@var_comments_reviewer` is mandatory when action is `2` or `3`

## Current bot contract

The bot already sends these values to Lurana:

- Approve -> `var_action_reviewer = 1`
- Correction -> `var_action_reviewer = 2`
- Reject -> `var_action_reviewer = 3`

And for correction/reject it also sends:

- `var_comments_reviewer`

## Recommended demo sequence

1. Simulate incoming case data from Lurana with `POST /processmaker/manager-review`
2. Director answers on WhatsApp
3. Bot sends `POST /test-lurana-review` equivalent payload to `updatePtoData`
4. Lurana should move the case through the exclusive gateway

If step 4 does not happen, the issue is on the Lurana side of derivation, not on the WhatsApp bot side.
