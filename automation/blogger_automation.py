#!/usr/bin/env python3
"""Automação segura do Flow Trend para Blogger API v3.

- Cria as páginas legais se ainda não existirem.
- Processa XML/JSON de matérias com limpeza, SEO, marcadores e resumo.
- Publica como rascunho por padrão; use --publish para publicar.
- O modo de reescrita "template" não inventa fatos. O modo "openai" é opcional
  e exige OPENAI_API_KEY; revise a saída antes da publicação.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

from bs4 import BeautifulSoup
SCOPES = ["https://www.googleapis.com/auth/blogger"]
API_BASE = "https://www.googleapis.com/blogger/v3"
TOKEN_FILE = Path(os.getenv("BLOGGER_TOKEN_FILE", "token.json"))
CLIENT_FILE = Path(os.getenv("BLOGGER_CLIENT_FILE", "client_secrets.json"))

LEGAL_PAGES = {
    "Política de Privacidade": """<h2>Política de Privacidade</h2>
<p><strong>Última atualização:</strong> {date}</p>
<p>O Flow Trend, disponível em <strong>https://flowtrend.com.br</strong>, é um portal de tecnologia, tendências e inovação. Esta Política explica como dados podem ser coletados, utilizados e protegidos.</p>
<h2>1. Controlador e contato</h2>
<p><strong>Controlador:</strong> Flow Trend<br><strong>E-mail:</strong> {email}</p>
<h2>2. Dados tratados</h2>
<p>Podemos tratar endereço IP, navegador, dispositivo, páginas visitadas, horários de acesso, origem da visita, preferências de cookies e informações fornecidas voluntariamente pelo visitante.</p>
<h2>3. Finalidades e bases legais</h2>
<p>Os dados podem ser utilizados para operar o site, responder contatos, analisar audiência, proteger a plataforma, cumprir obrigações legais e exibir publicidade. O tratamento poderá se basear em consentimento, obrigação legal, execução de contrato ou legítimo interesse, conforme a LGPD e, quando aplicável, o GDPR.</p>
<h2>4. Cookies e terceiros</h2>
<p>O site pode utilizar cookies essenciais, analíticos e de publicidade. Quando ativos, o Google AdSense e tecnologias da rede Google DFP/DoubleClick podem utilizar cookies, identificadores e tecnologias semelhantes para medir anúncios e, mediante consentimento quando exigido, exibir publicidade personalizada.</p>
<p>O visitante pode consultar ou alterar preferências em <a href="https://adssettings.google.com/" rel="noopener noreferrer" target="_blank">Configurações de anúncios do Google</a>.</p>
<h2>5. Como desativar cookies</h2>
<p>Cookies podem ser bloqueados ou excluídos nas configurações do navegador. No Chrome, acesse <strong>Configurações &gt; Privacidade e segurança &gt; Cookies de terceiros</strong>. No Firefox, Edge e Safari, procure as opções de privacidade, cookies e dados de sites. A desativação pode limitar funcionalidades e não impede necessariamente a publicidade.</p>
<h2>6. Compartilhamento e retenção</h2>
<p>Não vendemos dados pessoais. Dados podem ser processados por hospedagem, segurança, análise de audiência e publicidade. Mantemos as informações pelo tempo necessário às finalidades, obrigações legais e exercício de direitos.</p>
<h2>7. Direitos</h2>
<p>O titular pode solicitar acesso, correção, eliminação quando aplicável, informações sobre compartilhamento, oposição e revogação do consentimento pelo e-mail {email}.</p>
<h2>8. Segurança e alterações</h2>
<p>Adotamos medidas razoáveis de segurança, sem prometer risco zero na internet. Esta política pode ser atualizada e a versão vigente ficará nesta página.</p>
""",
    "Termos de Uso": """<h2>Termos de Uso</h2>
<p><strong>Última atualização:</strong> {date}</p>
<p>Estes Termos regulam o uso do Flow Trend, disponível em <strong>https://flowtrend.com.br</strong>. Ao navegar, o usuário declara que leu e aceita estas condições.</p>
<h2>1. Finalidade do site</h2>
<p>O Flow Trend organiza notícias, tendências e referências sobre tecnologia, inovação e assuntos em destaque. O conteúdo é informativo e não substitui aconselhamento jurídico, médico, financeiro ou profissional.</p>
<h2>2. Uso permitido</h2>
<p>É permitido usar o site para fins pessoais e informativos. É proibido praticar fraude, invadir sistemas, inserir malware, abusar de automações, copiar conteúdo integralmente sem autorização ou violar direitos de terceiros.</p>
<h2>3. Propriedade intelectual</h2>
<p>A marca, identidade visual, código, estrutura e textos editoriais próprios do Flow Trend são protegidos pela legislação aplicável. Pequenos trechos podem ser citados com atribuição e link para a página original. Conteúdo de terceiros permanece de titularidade de seus respectivos proprietários.</p>
<h2>4. Fontes externas</h2>
<p>O site pode apresentar links, imagens e informações de terceiros. Não controlamos a disponibilidade, precisão, segurança ou políticas desses sites. O acesso a links externos ocorre por conta do usuário.</p>
<h2>5. Publicidade e responsabilidade</h2>
<p>Podemos exibir anúncios, links afiliados e conteúdos patrocinados. A contratação de produtos ou serviços ocorre diretamente com o anunciante. O Flow Trend não garante resultados, disponibilidade ou adequação de ofertas de terceiros.</p>
<h2>6. Disponibilidade e limitações</h2>
<p>Buscamos manter o serviço disponível, mas podem ocorrer manutenção, erros ou interrupções. Não somos responsáveis por decisões tomadas exclusivamente com base no conteúdo, indisponibilidade externa ou falhas de conexão.</p>
<h2>7. Alterações e contato</h2>
<p>Estes Termos podem ser atualizados. Dúvidas e comunicações devem ser enviadas para <a href="mailto:{email}">{email}</a>.</p>
""",
    "Sobre Nós": """<h2>Sobre o Flow Trend</h2>
<p>O <strong>Flow Trend</strong> é um portal brasileiro de tecnologia, tendências e inovação. Nossa missão é transformar o fluxo acelerado de informações em uma experiência mais clara, útil e contextualizada.</p>
<h2>O que fazemos</h2>
<p>Acompanhamos assuntos relevantes e organizamos pautas em categorias como tecnologia, inovação, negócios, economia, cultura e sociedade. Sempre que possível, apresentamos fonte visível, contexto editorial e caminho para a publicação original.</p>
<h2>Nosso compromisso</h2>
<p>Valorizamos atribuição, transparência e linguagem responsável. Diferenciamos informação, contexto e opinião, evitando apresentar material de terceiros como produção própria. A curadoria não substitui a leitura das fontes originais.</p>
<h2>Transparência</h2>
<p>O Flow Trend pode utilizar publicidade, links patrocinados e programas de afiliados para financiar sua operação. Essas relações serão identificadas de maneira adequada e não alteram nosso compromisso com informação clara.</p>
<h2>Fale conosco</h2>
<p>Para sugerir uma pauta, comunicar uma correção ou falar sobre o projeto, escreva para <a href="mailto:{email}">{email}</a>.</p>
""",
}

@dataclass
class Article:
    title: str
    content: str
    source_url: str = ""
    source_name: str = ""
    category: str = "Tendências"
    original_title: str = ""


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(value or ""))).strip()


def slug_tokens(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", value)


def classify(title: str, content: str) -> str:
    text = slug_tokens(f"{title} {content}")
    rules = {
        "Esportes": r"futebol|jogo|campeonato|copa|atleta|nba|esporte|gol|torneio",
        "Política": r"politica|presidente|senado|governo|ministro|eleicao|congresso|stf",
        "Economia": r"economia|dolar|ibovespa|empresa|lucro|inflacao|mercado|acoes|banco|juros|pib",
        "Tecnologia": r"tecnologia|celular|iphone|android|software|inteligencia artificial|ai|tech|google|microsoft|apple|samsung",
        "Entretenimento": r"filme|serie|musica|artista|novela|celebridade|cinema|netflix|show",
        "Saúde": r"saude|hospital|medico|doenca|vacina|sus|pandemia|sintoma|tratamento",
        "Brasil": r"brasil|brasileiro|brasileira|sao paulo|rio de janeiro|bahia",
    }
    for category, pattern in rules.items():
        if re.search(pattern, text):
            return category
    return "Tendências"


def meta_description(text: str, limit: int = 150) -> str:
    plain = BeautifulSoup(text, "html.parser").get_text(" ", strip=True)
    plain = normalize_text(plain)
    if len(plain) <= limit:
        return plain
    cut = plain[: limit - 1].rsplit(" ", 1)[0]
    return cut.rstrip(".,;:!?-") + "…"


def clean_html(raw: str, source_url: str = "") -> str:
    soup = BeautifulSoup(raw or "", "html.parser")
    for tag in soup.find_all(["script", "style", "iframe", "object", "embed", "form"]):
        tag.decompose()
    for tag in soup.find_all(True):
        allowed = {"href", "src", "alt", "title", "target", "rel"}
        tag.attrs = {k: v for k, v in tag.attrs.items() if k in allowed}
        if tag.name == "a":
            href = tag.get("href", "")
            parsed = urlparse(href)
            if parsed.scheme not in {"http", "https", "mailto"}:
                tag.unwrap()
            else:
                tag["rel"] = "noopener noreferrer"
                tag["target"] = "_blank"
    for br in soup.find_all("br"):
        br.replace_with("\n")
    text = soup.get_text("\n", strip=True)
    paragraphs = [normalize_text(line) for line in text.splitlines() if normalize_text(line)]
    if not paragraphs:
        return "<p>Conteúdo editorial não disponível.</p>"
    # Rebuild a clean, semantic body instead of trusting broken source markup.
    return "\n".join(f"<p>{html.escape(paragraph)}</p>" for paragraph in paragraphs)


def safe_http_url(value: str) -> str:
    parsed = urlparse(value or "")
    return value if parsed.scheme in {"http", "https"} and parsed.netloc else ""


def rewrite_template(article: Article) -> Article:
    original = normalize_text(article.title)
    if "Em foco:" in article.content and "Por que este assunto importa" in article.content:
        return Article(
            title=original,
            content=article.content,
            source_url=article.source_url,
            source_name=article.source_name,
            category=article.category,
            original_title=article.original_title or original,
        )
    title = original
    if not re.search(r"FlowTrend", title, re.I):
        title = f"{original} — o que você precisa saber"
    body = clean_html(article.content, article.source_url)
    intro = f"<p><strong>Em foco:</strong> o Flow Trend acompanha os principais pontos de {html.escape(original)} e organiza as informações disponíveis para o leitor.</p>"
    conclusion = f"<h2>Por que este assunto importa</h2><p>O tema segue em acompanhamento. Consulte a fonte original para atualizações e considere o contexto completo antes de tirar conclusões.</p>"
    return Article(title=title, content=intro + body + conclusion, source_url=article.source_url, source_name=article.source_name, category=article.category, original_title=original)


def rewrite_openai(article: Article) -> Article:
    # Optional provider hook. It is deliberately explicit so the default script
    # never sends article text to a third party without the operator choosing it.
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY é obrigatório para --rewrite-mode openai")
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("Instale openai para usar --rewrite-mode openai") from exc
    client = OpenAI(api_key=key, base_url=os.getenv("OPENAI_API_BASE") or None)
    prompt = f"""Reescreva este artigo em português do Brasil sem inventar fatos. Preserve nomes, números, datas e incertezas. Gere JSON com title, content e description. O title deve ser original e SEO-friendly; description deve ter até 150 caracteres; content deve usar apenas <p>, <h2> e <h3>. Categoria: {article.category}. Fonte: {article.source_url}\n\nTítulo original: {article.original_title or article.title}\nConteúdo:\n{BeautifulSoup(article.content, 'html.parser').get_text(' ', strip=True)}"""
    result = client.chat.completions.create(model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"), messages=[{"role": "user", "content": prompt}], response_format={"type": "json_object"})
    data = json.loads(result.choices[0].message.content or "{}")
    return Article(title=normalize_text(data.get("title")) or article.title, content=clean_html(data.get("content", article.content)), source_url=article.source_url, source_name=article.source_name, category=article.category, original_title=article.original_title)


def parse_input(path: Path) -> list[Article]:
    if path.suffix.lower() == ".json":
        raw = json.loads(path.read_text(encoding="utf-8"))
        records = raw if isinstance(raw, list) else raw.get("items", raw.get("articles", []))
        return [Article(title=normalize_text(x.get("title")), content=x.get("content", x.get("description", "")), source_url=normalize_text(x.get("url", x.get("link", ""))), source_name=normalize_text(x.get("source", x.get("publisher", ""))), category=normalize_text(x.get("category", "")) or "") for x in records if x.get("title")]
    root = ET.parse(path).getroot()
    items = root.findall(".//item")
    articles = []
    for item in items:
        def text(*names: str) -> str:
            for name in names:
                node = item.find(name)
                if node is None:
                    node = item.find(f"{{*}}{name}")
                if node is not None and node.text:
                    return node.text
            return ""
        title = text("title")
        content = text("description", "encoded")
        link = text("link", "url")
        source = text("source", "publisher")
        if title:
            articles.append(Article(title=normalize_text(title), content=content, source_url=normalize_text(link), source_name=normalize_text(source)))
    return articles


def auth_service() -> Any:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    credentials = None
    if TOKEN_FILE.exists():
        credentials = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not credentials or not credentials.valid:
        if credentials and credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
        else:
            if not CLIENT_FILE.exists():
                raise FileNotFoundError(f"Credencial não encontrada: {CLIENT_FILE}")
            flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_FILE), SCOPES)
            credentials = flow.run_local_server(port=0, access_type="offline", prompt="consent")
        TOKEN_FILE.write_text(credentials.to_json(), encoding="utf-8")
    return build("blogger", "v3", credentials=credentials, cache_discovery=False)


def list_pages(service, blog_id: str) -> list[dict[str, Any]]:
    response = service.pages().list(blogId=blog_id, maxResults=50).execute()
    return response.get("items", [])


def ensure_legal_pages(service, blog_id: str, email: str, date: str, dry_run: bool) -> None:
    existing = {normalize_text(page.get("title")).casefold() for page in list_pages(service, blog_id)}
    for title, template in LEGAL_PAGES.items():
        if title.casefold() in existing:
            print(f"[skip] Página já existente: {title}")
            continue
        content = template.format(email=html.escape(email), date=html.escape(date))
        if dry_run:
            print(f"[dry-run] Criaria página: {title}")
        else:
            result = service.pages().insert(blogId=blog_id, body={"title": title, "content": content}).execute()
            print(f"[page] Criada: {result.get('url', title)}")


def existing_titles(service, blog_id: str) -> set[str]:
    titles: set[str] = set()
    request = service.posts().list(blogId=blog_id, maxResults=50, fetchBodies=False, status="live,draft")
    while request:
        response = request.execute()
        titles.update(normalize_text(item.get("title")).casefold() for item in response.get("items", []))
        request = service.posts().list_next(request, response)
    return titles


def prepare_article(article: Article, mode: str) -> tuple[Article, str]:
    article.category = article.category or classify(article.title, article.content)
    article.original_title = article.title
    prepared = rewrite_openai(article) if mode == "openai" else rewrite_template(article)
    return prepared, meta_description(prepared.content)


def publish_posts(
    service,
    blog_id: str,
    articles: Iterable[Article],
    mode: str,
    dry_run: bool,
    publish: bool,
    already_prepared: bool = False,
) -> None:
    titles = existing_titles(service, blog_id)
    for article in articles:
        prepared, description = (
            (article, meta_description(article.content))
            if already_prepared
            else prepare_article(article, mode)
        )
        if prepared.title.casefold() in titles:
            print(f"[skip] Post já existente: {prepared.title}")
            continue
        content = prepared.content
        source_url = safe_http_url(prepared.source_url)
        if source_url:
            content += f'<p><strong>Fonte original:</strong> <a href="{html.escape(source_url)}" rel="noopener noreferrer" target="_blank">{html.escape(prepared.source_name or source_url)}</a></p>'
        body = {"title": prepared.title, "content": content, "labels": [prepared.category], "customMetaData": description}
        if dry_run:
            print(f"[dry-run] Post: {prepared.title} | categoria={prepared.category} | description={description}")
            continue
        result = service.posts().insert(blogId=blog_id, isDraft=not publish, body=body).execute()
        print(f"[post] {'Publicado' if publish else 'Criado como rascunho'}: {result.get('url', prepared.title)}")
        titles.add(prepared.title.casefold())


def main() -> int:
    parser = argparse.ArgumentParser(description="Automação editorial segura do Flow Trend no Blogger")
    parser.add_argument("--blog-id", required=True, help="ID numérico do blog no Blogger")
    parser.add_argument("--input", type=Path, help="Arquivo .xml RSS ou .json de matérias")
    parser.add_argument("--contact-email", required=True, help="E-mail exibido nas páginas legais")
    parser.add_argument("--date", default=__import__('datetime').date.today().isoformat(), help="Data da política")
    parser.add_argument("--rewrite-mode", choices=["template", "openai"], default="template")
    parser.add_argument("--publish", action="store_true", help="Publica posts; sem esta flag cria rascunhos")
    parser.add_argument("--no-dry-run", action="store_true", help="Executa alterações na conta; por padrão apenas simula")
    parser.add_argument("--skip-pages", action="store_true")
    parser.add_argument("--skip-posts", action="store_true")
    args = parser.parse_args()
    service = auth_service()
    dry_run = not args.no_dry_run
    if dry_run:
        print("Modo seguro: nenhuma alteração será enviada. Use --no-dry-run para executar.")
    if not args.skip_pages:
        ensure_legal_pages(service, args.blog_id, args.contact_email, args.date, dry_run)
    if args.input and not args.skip_posts:
        articles = parse_input(args.input)
        publish_posts(service, args.blog_id, articles, args.rewrite_mode, dry_run, args.publish)
    elif not args.skip_posts:
        print("Nenhum --input informado; páginas processadas, posts ignorados.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Erro Blogger API: {error}", file=sys.stderr)
        raise SystemExit(2)
