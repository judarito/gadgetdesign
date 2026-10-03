import { createApp } from 'vue'
import vuetify from './plugins/vuetify'
import './styles/main.css'

// Cada ruta reservada tiene su propia aplicación. El resto de rutas de un solo
// segmento son códigos de ficha y las resuelve App.vue. La lista de nombres
// reservados vive en services/routes.js, compartida con las Functions.
const APPLICATIONS = {
  admin: () => import('./AdminApp.vue'),
  portal: () => import('./ClientApp.vue'),
}

const segments = window.location.pathname.split('/').filter(Boolean)
const route = segments.length === 1 ? segments[0].toLowerCase() : ''
const loadApplication = APPLICATIONS[route] ?? (() => import('./App.vue'))

const RootComponent = (await loadApplication()).default

createApp(RootComponent).use(vuetify).mount('#app')
