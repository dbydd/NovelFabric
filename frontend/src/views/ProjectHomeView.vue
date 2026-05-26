<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createProject, deleteProject, loadProjects, syncProjectsFromBackend, type NovelProject } from '../lib/workspace'

const router = useRouter()
const projects = ref<NovelProject[]>(loadProjects())
const title = ref('')
const description = ref('')
const hasProjects = computed(() => projects.value.length > 0)

onMounted(async () => {
  projects.value = await syncProjectsFromBackend()
})

async function removeProject(slug: string) {
  await deleteProject(slug)
  projects.value = await syncProjectsFromBackend()
}

async function submitProject() {
  const project = await createProject(title.value || '未命名小说项目', description.value || '文本优先的 NovelFabric 项目')
  projects.value = await syncProjectsFromBackend()
  if (!projects.value.find((entry) => entry.slug === project.slug)) {
    projects.value = loadProjects()
  }
  title.value = ''
  description.value = ''
  router.push(`/project/${project.slug}/settings`)
}
</script>

<template>
  <section class="home-view" data-testid="project-home">
    <div class="home-hero">
      <div>
        <p class="eyebrow">NovelFabric v1</p>
        <h1>文本文件驱动的文学创作工作台</h1>
        <p class="subtitle">创建小说项目，导入 txt，维护人物卡 / 规则卡 / 世界观卡，进入推演、创作与记忆管理流程。</p>
      </div>
      <form class="nf-panel create-card" aria-label="Create project" @submit.prevent="submitProject" data-testid="create-project-form">
        <div class="nf-panel-header">创建项目</div>
        <div class="nf-panel-body nf-form">
          <label class="nf-label" for="project-title">项目名称
            <input id="project-title" v-model="title" class="nf-input" autocomplete="off" data-testid="project-title-input" />
          </label>
          <label class="nf-label" for="project-description">项目描述
            <textarea id="project-description" v-model="description" class="nf-textarea" data-testid="project-description-input"></textarea>
          </label>
          <button class="nf-button" type="submit" data-testid="create-project-button">创建并进入项目</button>
        </div>
      </form>
    </div>

    <section class="project-list nf-panel" aria-label="Projects" data-testid="project-list">
      <div class="nf-panel-header">项目列表 <span class="nf-badge">{{ projects.length }}</span></div>
      <div v-if="!hasProjects" class="nf-empty" data-testid="empty-projects">还没有项目。先创建一个项目，再导入小说文本。</div>
      <div v-else class="project-grid">
        <article v-for="project in projects" :key="project.slug" class="project-card" data-testid="project-card">
          <h2>{{ project.title }}</h2>
          <p>{{ project.description }}</p>
          <dl>
            <div><dt>卡片</dt><dd>{{ project.cards.length }}</dd></div>
            <div><dt>记忆</dt><dd>{{ project.memory.length }}</dd></div>
            <div><dt>章节</dt><dd>{{ project.chapters.length }}</dd></div>
          </dl>
          <div class="project-actions"><button class="nf-button secondary" type="button" @click="router.push(`/project/${project.slug}/simulation`)" :data-testid="`open-${project.slug}`">打开工作区</button><button class="nf-button danger" type="button" @click="removeProject(project.slug)" :data-testid="`delete-${project.slug}`">删除项目</button></div>
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
.home-view { padding: var(--nf-space-5); display: grid; gap: var(--nf-space-5); }
.home-hero { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: var(--nf-space-5); align-items: start; }
.eyebrow { margin: 0 0 8px; color: var(--nf-primary); font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; }
h1 { margin: 0; font-size: clamp(32px, 5vw, 56px); line-height: 1.05; max-width: 780px; }
.subtitle { max-width: 760px; color: var(--nf-muted); font-size: 18px; }
.create-card { align-self: stretch; }
.project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--nf-space-4); padding: var(--nf-space-4); }
.project-card { border: 1px solid var(--nf-border); border-radius: var(--nf-radius); padding: var(--nf-space-4); background: #fff; display: grid; gap: var(--nf-space-3); }
.project-card h2 { margin: 0; }
.project-card p { margin: 0; color: var(--nf-muted); }
.project-actions { display: flex; gap: var(--nf-space-2); flex-wrap: wrap; }
dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0; }
dt { color: var(--nf-muted); font-size: 12px; font-weight: 800; }
dd { margin: 0; font-weight: 900; }
@media (max-width: 900px) { .home-hero { grid-template-columns: 1fr; } }
</style>
