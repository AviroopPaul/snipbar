// Shared between the content script and the popup.
// Every provider takes the selected text as a plain ?q= style query parameter.
const SNIPBAR_ENGINES = {
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { label: 'Brave', url: 'https://search.brave.com/search?q=' },
};

const SNIPBAR_ASSISTANTS = {
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/?q=' },
  claude: { label: 'Claude', url: 'https://claude.ai/new?q=' },
  perplexity: { label: 'Perplexity', url: 'https://www.perplexity.ai/search?q=' },
};

const SNIPBAR_DEFAULTS = { engine: 'google', assistant: 'chatgpt' };
