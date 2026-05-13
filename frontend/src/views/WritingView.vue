<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { addReviewNote, createChapter as createChapterRequest, createWritingBranch, ensureProject, updateChapter, type ChapterRecord, type NovelProject, type ReviewNote } from '../lib/workspace'

const route = useRoute()
const slug = computed(() => String(route.params.slug))
const project = ref<NovelProject | undefined>(undefined)
const selectedId = ref('')
const branchReason = ref('需要修改历史章节，按连续性规则创建时间线分叉。')
const reviewBody = ref('字数、合规性与前文一致性均需审核。')
const reviewNotes = ref<ReviewNote[]>([])

const selected = computed(() => project.value?.chapters.find((chapter) => chapter.id === selectedId.value))
const currentChapter = computed(() => project.value?.chapters.find((chapter) => chapter.isCurrent))
const isCurrent = computed(() => selected.value?.id === currentChapter.value?.id)
const title = ref('')
const body = ref('')

onMounted(async () => {
  project.value = await ensureProject(slug.value)
  const chapter = project.value?.chapters.find((entry) => entry.isCurrent) ?? project.value?.chapters[0]
  if (chapter) {
    selectedId.value = chapter.id
    title.value = chapter.title
    body.value = chapter.body
  }
})

function syncEditor(chapter: ChapterRecord) { selectedId.value = chapter.id; title.value = chapter.title; body.value = chapter.body; reviewNotes.value = [] }
async function saveChapter() {
  if (!project.value || !selected.value || !isCurrent.value) return
  await updateChapter(project.value.slug, selected.value.id, { title: title.value, body: body.value })
  project.value = await ensureProject(project.value.slug)
}
async function createChapter() {
  if (!project.value) return
  const id = `chapter-${String(project.value.chapters.length + 1).padStart(3, '0')}`
  await createChapterRequest(project.value.slug, { id, title: `新章节 ${project.value.chapters.length + 1}`, body: '基于上一章更新人物卡、世界观设定与记忆。' })
  project.value = await ensureProject(project.value.slug)
  const next = project.value?.chapters.find((chapter) => chapter.id === id)
  if (next) syncEditor(next)
}
async function addChapterReview() {
  if (!project.value || !selected.value) return
  reviewNotes.value = await addReviewNote(project.value.slug, selected.value.id, { reviewer: 'reviewer', body: reviewBody.value })
}

async function branchFromHistorical() {
  if (!project.value || !selected.value || isCurrent.value) return
  await createWritingBranch(project.value.slug, {
    sourceChapterId: selected.value.id,
    branchId: `branch-${Date.now()}`,
    branchTitle: `从 ${selected.value.title} 分叉`,
    branchDescription: branchReason.value,
    branchReason: branchReason.value,
    originTimepointId: '0001',
  })
  project.value = await ensureProject(project.value.slug)
}
</script>

<template>
  <section v-if="project" class="writing-view" data-testid="writing-view">
    <aside class="chapter-pane nf-panel" data-testid="chapter-list">
      <div class="nf-panel-header">章节列表 <button class="nf-button" type="button" @click="createChapter" data-testid="new-chapter-button">新建章节</button></div>
      <div class="chapter-list">
        <button v-for="chapter in project.chapters" :key="chapter.id" class="chapter-item" :class="{ active: chapter.id === selectedId }" type="button" @click="syncEditor(chapter)" data-testid="chapter-item">
          <span>{{ chapter.title }}</span><span class="nf-badge">{{ chapter.isCurrent ? '当前' : '只读' }}</span>
        </button>
      </div>
    </aside>
    <main class="editor-pane nf-panel" data-testid="chapter-editor">
      <div class="nf-panel-header">章节编辑 <span class="nf-badge">{{ isCurrent ? '可编辑' : '历史只读' }}</span></div>
      <div class="editor-body">
        <label class="nf-label">标题<input v-model="title" class="nf-input" :readonly="!isCurrent" data-testid="chapter-title-input" /></label>
        <label class="nf-label">正文<textarea v-model="body" class="nf-textarea chapter-body" :readonly="!isCurrent" data-testid="chapter-body-input"></textarea></label>
        <button v-if="isCurrent" class="nf-button accent" type="button" @click="saveChapter" data-testid="save-chapter-button">保存当前章节</button>
        <div class="review-box" data-testid="review-box">
          <label class="nf-label">审核意见<textarea v-model="reviewBody" class="nf-textarea" data-testid="review-body-input"></textarea></label>
          <button class="nf-button secondary" type="button" @click="addChapterReview" data-testid="add-review-button">添加审核意见</button>
          <article v-for="note in reviewNotes" :key="`${note.reviewer}-${note.body}`" class="review-note" data-testid="review-note"><strong>{{ note.reviewer }}</strong><p>{{ note.body }}</p></article>
        </div>
        <div v-if="!isCurrent" class="branch-box" data-testid="branch-box">
          <p>历史章节不可直接修改。若要修改，必须完整回退至该时间点并产生分叉。</p>
          <label class="nf-label">分叉原因<textarea v-model="branchReason" class="nf-textarea" data-testid="branch-reason-input"></textarea></label>
          <button class="nf-button" type="button" @click="branchFromHistorical" data-testid="create-branch-button">创建时间线分叉</button>
        </div>
      </div>
    </main>
    <aside class="branch-pane nf-panel" data-testid="branch-list">
      <div class="nf-panel-header">时间线分叉</div>
      <div class="nf-panel-body nf-grid">
        <article v-for="branch in project.branches" :key="branch.id" class="branch-card" data-testid="branch-card"><strong>{{ branch.title }}</strong><p>{{ branch.reason }}</p><span class="nf-badge">{{ branch.sourceChapterId }}</span></article>
        <p v-if="project.branches.length === 0" class="nf-empty">暂无分叉</p>
      </div>
    </aside>
  </section>
  <p v-else class="nf-empty">项目不存在</p>
</template>

<style scoped>
.writing-view { height: calc(100vh - var(--nf-header)); display: grid; grid-template-columns: 280px minmax(0, 1fr) 280px; gap: var(--nf-space-3); padding: var(--nf-space-3); }
.chapter-pane, .editor-pane, .branch-pane { min-height: 0; overflow: auto; }
.chapter-list { display: grid; }
.chapter-item { display: flex; justify-content: space-between; gap: var(--nf-space-2); padding: var(--nf-space-3); border: 0; border-bottom: 1px solid var(--nf-border); background: #fff; text-align: left; cursor: pointer; }
.chapter-item.active { border-left: 4px solid var(--nf-primary); background: var(--nf-panel-muted); }
.editor-body { display: grid; gap: var(--nf-space-4); padding: var(--nf-space-4); }
.chapter-body { min-height: 54vh; }
.branch-box, .branch-card, .review-box, .review-note { display: grid; gap: var(--nf-space-3); border: 1px solid var(--nf-border); border-radius: var(--nf-radius); padding: var(--nf-space-4); background: #fff; }
.branch-card p { margin: 0; color: var(--nf-muted); }
@media (max-width: 1100px) { .writing-view { grid-template-columns: 1fr; height: auto; } }
</style>
