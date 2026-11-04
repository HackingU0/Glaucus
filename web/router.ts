import { createRouter, createWebHistory } from 'vue-router'
import Login from './pages/Login.vue'
import Register from './pages/Register.vue'
import Entries from './pages/Entries.vue'
import NewEntry from './pages/NewEntry.vue'
import Entry from './pages/Entry.vue'
import Admin from './pages/Admin.vue'
import { loadMe, me, refresh } from './api'

// meta.bare: no top bar (auth pages). meta.ownMobileHeader: page draws its own header below md.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login, meta: { bare: true } },
    { path: '/register', component: Register, meta: { bare: true } },
    { path: '/', component: Entries },
    { path: '/new', component: NewEntry },
    { path: '/entries/:id', component: Entry, meta: { ownMobileHeader: true } },
    { path: '/admin', component: Admin },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// Login → register real name → app. Lists are refetched on every navigation (small team, cheap).
router.beforeEach(async (to) => {
  if (to.path === '/login') return
  if (!me.discord_id && !(await loadMe())) return '/login'
  if (!me.real_name) return to.path === '/register' || '/register'
  if (to.path !== '/register') await refresh()
})
