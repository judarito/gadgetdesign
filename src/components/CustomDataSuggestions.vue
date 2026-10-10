<script setup>
import { CalendarDays, LockKeyhole } from '@lucide/vue'

/* eslint-disable vue/no-mutating-props -- suggestion drafts are owned by App.vue. */
defineProps({
  visible: { type: Boolean, default: false }, categoryName: { type: String, default: '' }, drafts: { type: Array, required: true }, selected: { type: Object, default: null }, isLoading: { type: Boolean, default: false }, isSaving: { type: Boolean, default: false }, authorized: { type: Boolean, default: false }, canRequestCode: { type: Boolean, default: false }, canUseCrud: { type: Boolean, default: false }, savingKey: { type: String, default: '' }, customDataKeyMaxLength: { type: Number, required: true }, customDataValueMaxLength: { type: Number, required: true }, getDataType: { type: Function, required: true },
})

const emit = defineEmits(['select', 'save', 'close', 'open-date-picker', 'open-date-picker-trigger'])
</script>

<template>
  <section v-if="visible && !isLoading" class="suggestions-panel">
    <div class="suggestions-heading"><h3>Sugerencias para {{ categoryName || 'esta categoría' }}</h3><p>Selecciona una para agregarla.</p></div>
    <div class="suggestion-options" aria-label="Sugerencias disponibles">
      <button v-for="draft in drafts" :key="draft.id" class="suggestion-option" :class="{ 'suggestion-option--selected': selected?.id === draft.id, 'suggestion-option--locked': !authorized }" :disabled="isLoading || isSaving || (!authorized && !canRequestCode)" type="button" @click="emit('select', draft)"><LockKeyhole v-if="!authorized" :size="14" aria-hidden="true" />{{ draft.key }}</button>
    </div>
    <form v-if="selected" class="inline-row inline-row--suggestion" @submit.prevent="emit('save', selected, `suggestion-${selected.id}`)">
      <label><span>Dato <small>{{ getDataType(selected.dataType).label }}</small></span><input v-model="selected.key" :disabled="!canUseCrud" :maxlength="customDataKeyMaxLength" aria-label="Dato sugerido" /></label>
      <label><span>Valor</span><div class="value-input-shell" :class="{ 'value-input-shell--date': selected.dataType === 'date' }"><input v-model="selected.value" :type="getDataType(selected.dataType).inputType" :disabled="!canUseCrud" :maxlength="customDataValueMaxLength" :placeholder="getDataType(selected.dataType).placeholder" aria-label="Valor del dato sugerido" @pointerdown.capture="emit('open-date-picker', $event, selected.dataType)" /><button v-if="selected.dataType === 'date'" class="date-picker-trigger" type="button" tabindex="-1" aria-label="Abrir selector de fecha" @click="emit('open-date-picker-trigger')" /><CalendarDays v-if="selected.dataType === 'date'" class="date-picker-icon" :size="19" aria-hidden="true" /></div></label>
      <label class="protection-toggle"><input v-model="selected.protected" type="checkbox" /><span><LockKeyhole :size="16" /> Proteger valor</span></label>
      <div class="suggestion-actions"><v-btn class="save-button" color="primary" :disabled="!canUseCrud || !selected.key.trim() || !selected.value.trim()" :loading="savingKey === `suggestion-${selected.id}`" type="submit" variant="flat"><AppIcon name="save" />Guardar</v-btn><v-btn class="cancel-button" icon :disabled="!canUseCrud" type="button" variant="flat" aria-label="Cerrar sugerencia" @click="emit('close')"><AppIcon name="close" /></v-btn></div>
    </form>
  </section>
</template>

<style>
.suggestions-panel { margin: 0 0 14px; padding: 14px 16px; border: 1px dashed #bed8f4; border-radius: 14px; background: rgba(244, 250, 255, .82); }
.suggestions-panel h3 { margin: 0; color: #304d89; font-size: .98rem; font-weight: 800; }
.suggestions-heading { margin-bottom: 12px; }
.suggestions-heading p { margin: 3px 0 0; color: #687da9; font-size: .82rem; }
.suggestion-options { display: flex; flex-wrap: wrap; gap: 8px; }
.suggestion-option { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 7px 13px; color: #0867e8; font: inherit; font-size: .86rem; font-weight: 750; line-height: 1.2; text-align: left; cursor: pointer; background: #fff; border: 1px solid #c9def6; border-radius: 999px; }
.suggestion-option:hover:not(:disabled), .suggestion-option--selected { color: #fff; background: #0873ff; border-color: #0873ff; }
.suggestion-option:disabled { cursor: not-allowed; opacity: .55; }
.suggestion-option--locked:not(:disabled) { color: #345f98; background: #f4f8fc; border-color: #cbdced; }
.inline-row--suggestion { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto; align-items: end; gap: 12px; margin-top: 14px; }
.inline-row--suggestion label { display: grid; gap: 6px; color: #344e82; font-size: .83rem; font-weight: 750; }
.inline-row--suggestion input { min-height: 44px; padding: 0 12px; color: #101d42; background: #fff; border: 1px solid #c9def6; border-radius: 9px; }
.inline-row--suggestion small { color: #5870ad; font-size: .76rem; }
.value-input-shell { position: relative; display: flex; align-items: center; }
.value-input-shell input { width: 100%; }
.date-picker-trigger { position: absolute; inset: 0 0 0 auto; width: 42px; cursor: pointer; background: transparent; border: 0; }
.date-picker-icon { position: absolute; right: 11px; pointer-events: none; color: #2861b9; }
.protection-toggle { display: flex !important; align-items: center; gap: 7px !important; min-height: 44px; padding: 0 10px; color: #28558f !important; background: #eef6ff; border: 1px solid #d0e3f8; border-radius: 9px; white-space: nowrap; }
.protection-toggle input { width: 17px; min-height: 17px; }
.protection-toggle span { display: inline-flex; align-items: center; gap: 5px; }
.suggestion-actions { display: flex; gap: 8px; }
.suggestion-actions .v-btn { min-height: 44px; }
@media (max-width: 760px) { .inline-row--suggestion { grid-template-columns: 1fr; } .suggestion-actions { justify-content: flex-end; } }
</style>
