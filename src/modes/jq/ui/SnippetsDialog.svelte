<script lang="ts">
  /**
   * 쿼리 스니펫. 고르면 쿼리를 통째로 바꾸고 `"qsp"` 자리표시자를 선택 상태로 둔다
   * (바로 타이핑하면 패턴이 교체된다).
   */
  import Modal from '../../../lib/ui/Modal.svelte'
  import { CATEGORY_LABEL, CATEGORY_ORDER, SNIPPETS, type Snippet } from '../data/snippets'

  interface Props {
    onPick: (query: string) => void
    onClose: () => void
  }
  let { onPick, onClose }: Props = $props()

  const groups = CATEGORY_ORDER.map((c) => ({
    category: c,
    label: CATEGORY_LABEL[c],
    items: SNIPPETS.filter((s) => s.category === c),
  })).filter((g) => g.items.length > 0)

  function pick(s: Snippet): void {
    onPick(s.query)
  }
</script>

<Modal label="쿼리 스니펫" title="스니펫" width="940px" maxHeight="88vh" {onClose}>
  {#each groups as g (g.category)}
    <section>
      <h3 class="label">{g.label}</h3>
      <div class="grid">
        {#each g.items as s (s.id)}
          <button class="card" onclick={() => pick(s)}>
            <span class="title">{s.title}</span>
            <span class="desc">{s.desc}</span>
            <pre class="code">{s.query}</pre>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</Modal>

<style>
  h3 {
    margin: 12px 0 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 9px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 7px;
    text-align: left;
    transition: border-color var(--dur) var(--ease);
  }
  .card:hover {
    border-color: var(--accent-line);
  }
  .title {
    color: var(--text);
    font-weight: 600;
  }
  .desc {
    color: var(--text-dim);
    font-size: var(--fs-label);
    line-height: 1.5;
  }
  .code {
    margin: 3px 0 0;
    padding: 6px 7px;
    max-height: 106px;
    overflow: auto;
    background: var(--bg-raised);
    border: 1px solid var(--border-soft);
    border-radius: 5px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--text-dim);
    white-space: pre;
  }
</style>
