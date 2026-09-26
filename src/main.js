import { createApp } from 'vue'
import vuetify from './plugins/vuetify'
import './styles/main.css'

const isAdminRoute = window.location.pathname.replace(/\/+$/, '') === '/admin'
const RootComponent = isAdminRoute
  ? (await import('./AdminApp.vue')).default
  : (await import('./App.vue')).default

createApp(RootComponent).use(vuetify).mount('#app')
