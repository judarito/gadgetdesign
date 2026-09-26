import 'vuetify/styles'
import { createVuetify } from 'vuetify'

export default createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#0873ff',
          secondary: '#19d8df',
          surface: '#ffffff',
          background: '#f7fbff',
        },
      },
    },
  },
})
