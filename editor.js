/**
 * NIP-98 Editor Pane
 * A read-write pane for jsonos.com / Solid that saves content via HTTP PUT
 * with NIP-98 authentication from a NIP-07 signer (window.nostr).
 *
 * @view https://nip98.com/editor.js
 */

async function nip98Token (url, method, body) {
  const tags = [['u', url], ['method', method]]
  if (body) {
    const hash = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(body)
    )
    tags.push(['payload', [...new Uint8Array(hash)]
      .map(b => b.toString(16).padStart(2, '0')).join('')])
  }
  const signed = await window.nostr.signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  })
  return 'Nostr ' + btoa(JSON.stringify(signed))
}

export default {
  name: 'nip98Editor',

  icon: 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>'
  ),

  label: function (subject, context) {
    return 'Editor'
  },

  render: function (subject, context) {
    const dom = context.dom || document
    const store = context.session?.store
    const resourceUrl = subject?.doc?.()?.uri || subject?.uri || window.location.href

    // Container
    const div = dom.createElement('div')
    div.className = 'nip98-editor-pane'
    div.style.cssText = `
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      padding: 24px;
      max-width: 720px;
      margin: 0 auto;
    `

    // Header
    const header = dom.createElement('div')
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    `

    const title = dom.createElement('div')
    title.style.cssText = 'font-size: 0.85rem; color: #666; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;'
    title.textContent = resourceUrl
    header.appendChild(title)

    // Status
    const status = dom.createElement('span')
    status.style.cssText = 'font-size: 0.8rem; color: #999;'
    status.textContent = ''
    header.appendChild(status)

    div.appendChild(header)

    // Textarea
    const textarea = dom.createElement('textarea')
    textarea.style.cssText = `
      width: 100%;
      min-height: 300px;
      padding: 16px;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
      line-height: 1.6;
      resize: vertical;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.2s;
    `
    textarea.addEventListener('focus', () => {
      textarea.style.borderColor = '#667eea'
    })
    textarea.addEventListener('blur', () => {
      textarea.style.borderColor = '#e2e8f0'
    })

    // Load current content
    if (store) {
      // In pane context: read schema:text or serialize the resource
      const SCHEMA = $rdf.Namespace('http://schema.org/')
      const text = store.anyValue(subject, SCHEMA('text'))
      textarea.value = text || ''
    }

    // Also try fetching raw content
    if (!textarea.value) {
      fetch(resourceUrl, { headers: { Accept: 'text/plain, */*' } })
        .then(r => r.ok ? r.text() : '')
        .then(text => { if (!textarea.value) textarea.value = text })
        .catch(() => {})
    }

    div.appendChild(textarea)

    // Button row
    const buttons = dom.createElement('div')
    buttons.style.cssText = 'display: flex; gap: 8px; margin-top: 12px; align-items: center;'

    // Save button
    const saveBtn = dom.createElement('button')
    saveBtn.textContent = 'Save'
    saveBtn.style.cssText = `
      padding: 8px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    `
    saveBtn.addEventListener('mouseenter', () => { saveBtn.style.opacity = '0.9' })
    saveBtn.addEventListener('mouseleave', () => { saveBtn.style.opacity = '1' })

    saveBtn.addEventListener('click', async () => {
      if (!window.nostr) {
        status.textContent = 'No signer — install a NIP-07 extension'
        status.style.color = '#e53e3e'
        return
      }

      saveBtn.disabled = true
      saveBtn.style.opacity = '0.6'
      status.textContent = 'Signing...'
      status.style.color = '#999'

      try {
        const body = textarea.value
        const auth = await nip98Token(resourceUrl, 'PUT', body)

        status.textContent = 'Saving...'
        const res = await fetch(resourceUrl, {
          method: 'PUT',
          headers: {
            Authorization: auth,
            'Content-Type': 'text/plain'
          },
          body
        })

        if (res.ok) {
          status.textContent = 'Saved'
          status.style.color = '#38a169'
        } else {
          status.textContent = `${res.status} ${res.statusText}`
          status.style.color = '#e53e3e'
        }
      } catch (err) {
        status.textContent = err.message
        status.style.color = '#e53e3e'
      }

      saveBtn.disabled = false
      saveBtn.style.opacity = '1'
    })

    buttons.appendChild(saveBtn)

    // Keyboard shortcut hint
    const hint = dom.createElement('span')
    hint.style.cssText = 'font-size: 0.75rem; color: #aaa;'
    hint.textContent = 'Ctrl+S to save'
    buttons.appendChild(hint)

    div.appendChild(buttons)

    // Ctrl+S handler
    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveBtn.click()
      }
    })

    return div
  }
}
