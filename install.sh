#!/bin/sh
# Instala o plugin Antigravity (agy) para o OpenCode 2 no macOS/Linux.
# Uso (na pasta onde você extraiu o zip):  sh install.sh
set -e

here=$(cd "$(dirname "$0")" && pwd)
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
plugin_dir="$config_dir/plugins/agy"
config="$config_dir/opencode.json"

ok() { printf '  [ok] %s\n' "$1"; }
warn() { printf '  [aviso] %s\n' "$1"; }

# Valida JSON com o que existir na máquina (node ou python3). Sai 2 se nenhum existir.
json_valid() {
  if command -v node >/dev/null 2>&1; then node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$1" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then python3 -c 'import json, sys; json.load(open(sys.argv[1]))' "$1" 2>/dev/null
  else return 2; fi
}

printf '\nPlugin Antigravity (agy) para OpenCode\n\n'

# 1. Pré-requisitos (só avisa, não impede a instalação)
if command -v opencode >/dev/null 2>&1; then
  version=$(opencode --version 2>/dev/null || true)
  case "$version" in
    *v[2-9].* | [2-9].*) ok "OpenCode $version" ;;
    *) warn "Seu OpenCode é '$version', mas este plugin precisa do OpenCode 2.x (atualize com: opencode upgrade)." ;;
  esac
else
  warn "O comando 'opencode' não foi encontrado. Instale o OpenCode 2 antes de usar o plugin."
fi
if command -v agy >/dev/null 2>&1; then ok "agy encontrado no PATH"
else warn "O agy não foi encontrado. Instale o Antigravity CLI e rode 'agy' uma vez no terminal para fazer login."; fi

# O agy ignora o settings.json INTEIRO se ele tiver erro de sintaxe (vírgula faltando/sobrando).
agy_settings="$HOME/.gemini/antigravity-cli/settings.json"
if [ -f "$agy_settings" ]; then
  status=0
  json_valid "$agy_settings" || status=$?
  if [ "$status" -eq 0 ]; then ok "settings.json do agy é válido"
  elif [ "$status" -eq 1 ]; then warn "$agy_settings tem erro de sintaxe; o agy vai ignorar todas as configurações dele. Veja 'Problemas comuns' no README."; fi
fi

# 2. Copia o plugin
is_update=no
[ -f "$plugin_dir/server.js" ] && is_update=yes
mkdir -p "$plugin_dir"
cp "$here"/agy/* "$plugin_dir"/
ok "Plugin copiado para $plugin_dir"

# 3. Configuração do OpenCode
if [ ! -f "$config" ]; then
  cp "$here/opencode.example.json" "$config"
  ok "Criado $config"
elif grep -q '"agy"[[:space:]]*:' "$config"; then
  ok "O opencode.json já tem providers.agy; mantive a sua configuração."
else
  cp "$config" "$config.bak-agy"
  merged=no
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs"), [config, example] = process.argv.slice(1)
      const data = JSON.parse(fs.readFileSync(config, "utf8"))
      data.providers = { ...(data.providers || {}), agy: JSON.parse(fs.readFileSync(example, "utf8")).providers.agy }
      fs.writeFileSync(config, JSON.stringify(data, null, 2) + "\n")
    ' "$config" "$here/opencode.example.json" 2>/dev/null && merged=yes
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
config, example = sys.argv[1], sys.argv[2]
data = json.load(open(config))
data.setdefault("providers", {})["agy"] = json.load(open(example))["providers"]["agy"]
json.dump(data, open(config, "w"), indent=2)
' "$config" "$here/opencode.example.json" 2>/dev/null && merged=yes
  fi
  if [ "$merged" = yes ]; then
    ok "Adicionado providers.agy em $config (backup em $config.bak-agy)"
  else
    warn "Não consegui editar $config automaticamente (comentários no arquivo, ou sem node/python3)."
    warn "Copie manualmente o bloco \"agy\" de opencode.example.json para dentro de \"providers\"."
  fi
fi

if [ "$is_update" = yes ]; then
  printf "\nAtualização: rode 'opencode service restart' uma vez para o serviço do OpenCode carregar a versão nova.\n"
fi
printf '\nPronto! Feche e abra o OpenCode de novo, depois confira com:\n  opencode models\n'
printf 'Os modelos aparecem como agy/<modelo> (grupo "Antigravity (agy)" no /models).\n\n'
