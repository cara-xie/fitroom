/* Fitroom AI Worker (Cloudflare). Paste this whole file into the fitroom-ai Worker and Deploy.
   The API key stays in the Worker as the secret ANTHROPIC_API_KEY; it is never in the website. */
const ALLOWED = ["https://cara-xie.github.io"];
const MODEL = "claude-haiku-5-5";

/* Fallback style list. The website also sends its own list (from styles.js), which is used when present. */
const DEFAULT_STYLES = ["Modernist","Contemporary","Minimalist","Warm minimalism","Organic modern","Scandinavian","Japandi","Mid-century","Bauhaus-inspired","Industrial loft","Brutalist-inspired","Contemporary Italian","Wabi-sabi","Belgian rustic","Rustic cabin","Modern mountain","Alpine chalet","Traditional farmhouse","Modern farmhouse","Desert modern","Southwestern","Biophilic","Relaxed coastal","Hamptons","California casual","Mediterranean","Modern Mediterranean","Spanish Revival","Tuscan country","Greek island","French Riviera","Tropical contemporary","Balinese resort","Soft pink","Traditional","Transitional","Modern traditional","English country","English cottage","French country","Parisian apartment","Neoclassical","Georgian / Regency","Victorian","Arts and Crafts","Grandmillennial","Art Deco","Hollywood Regency","Contemporary luxury","Eclectic","Maximalist","Bohemian","Jungalow","Memphis / postmodern","1970s retro","Space-age retrofuturism","Cosmic / space","Dark academia","Moroccan-inspired","Traditional Japanese","Contemporary Chinese","Indian contemporary"];

const STYLE_SYSTEM =
  "You are an interior design assistant for Fitroom. The person may give written words, photos of rooms they like, or both. " +
  "Read everything they say, including themes and moods that are not decor words (for example space, NASA, ocean, Paris, cute, moody), " +
  "and pick the single closest style from the allowed list. When photos are given, judge style, materials, shapes, mood and palette, not only colors. " +
  "Colors must match what they asked for (for example deep blue means dark navy hex codes). Always answer by calling the set_vibe tool.";

const SIZE_SYSTEM =
  'You read text taken from a furniture product web page. Find the overall dimensions of the main item in inches (convert centimeters by dividing by 2.54). Width is the longest side along the front, depth is front to back, height is floor to top. If several sizes or variants are listed, use the first or default one and say so in "note". If the page has no dimensions, use null. Reply with ONLY JSON: {"name":"short product name","width_in":number or null,"depth_in":number or null,"height_in":number or null,"note":"one short sentence"}';

/* When the store blocks our own page fetch (or the page hides its sizes), Claude opens the link itself
   with its web fetch tool, and if that is blocked too, searches the web for the same product's dimensions. */
const BROWSE_SYSTEM =
  "You find the overall dimensions of one furniture product for a room-planning app. Open the product link with web_fetch. " +
  "If the page is blocked, empty or has no dimensions, use web_search for the exact product name (from the page title or the link's words) plus 'dimensions', " +
  "and prefer the store's own pages, then other big retailers selling the identical item. Never guess or use a different product. " +
  "Width is the longest side along the front, depth is front to back, height is floor to top, all in inches (centimeters / 2.54). " +
  'Finish with ONLY this JSON and nothing else: {"name":"short product name","width_in":number or null,"depth_in":number or null,"height_in":number or null,"note":"one short sentence saying where the size came from"}';

const FIND_SYSTEM =
  "You look at one photo of a room and list the furniture standing on the floor that will stay in the room (sofas, beds, tables, chairs, desks, dressers, shelves, cabinets, TV stands). " +
  "Skip rugs, wall art, lamps, plants, small items and anything not touching the floor. For each piece give the point on the floor directly under its center, " +
  "as x and y from 0 to 1000 across and down the whole image (0,0 is the top-left corner). If the bottom is hidden, estimate where the floor under its center is. " +
  "Also estimate its width (along its front) and depth in inches from typical sizes, and whether its front faces the camera ('camera') or a side wall ('side'). Always answer by calling the found tool.";

function findTool(kinds) {
  return {
    name: "found",
    description: "Record the furniture on the floor in the photo. Call this exactly once (an empty list is fine).",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: kinds },
              x: { type: "number", description: "0-1000 across the image" },
              y: { type: "number", description: "0-1000 down the image" },
              width_in: { type: "number" },
              depth_in: { type: "number" },
              facing: { type: "string", enum: ["camera", "side"] },
            },
            required: ["kind", "x", "y"],
          },
        },
      },
      required: ["items"],
    },
  };
}

async function browseForSize(env, url) {
  const messages = [{ role: "user", content: [{ type: "text", text: `Find the dimensions of the product at this link: ${url}` }] }];
  const tools = [
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 3, max_content_tokens: 30000 },
    { type: "web_search_20250305", name: "web_search", max_uses: 3 },
  ];
  let data = null;
  for (let turn = 0; turn < 3; turn++) {          // long searches can pause; let them continue twice
    data = await callClaude(env, { max_tokens: 1500, system: BROWSE_SYSTEM, tools, messages });
    if (data.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: data.content });
  }
  const texts = (data && data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = texts.match(/\{[^{}]*"width_in"[^{}]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

function vibeTool(styles) {
  return {
    name: "set_vibe",
    description: "Record the design style and details read from the person's words and photos. Call this exactly once.",
    input_schema: {
      type: "object",
      properties: {
        style: { type: "string", enum: styles, description: "The single closest style from the allowed list." },
        colors: { type: "array", items: { type: "string", description: "Hex color like #1B2A4A" }, description: "3 to 5 hex colors for the palette they described." },
        mustHave: { type: "array", items: { type: "string" }, description: "Up to 4 furniture pieces they want, each 1 to 3 words." },
        budget: { type: "string", enum: ["low", "mid", "high"] },
        words: { type: "array", items: { type: "string" }, description: "Up to 8 short words for the colors, materials, shapes and mood noticed." },
        reason: { type: "string", description: "One short sentence, under 25 words, on why this style fits." },
      },
      required: ["style", "colors", "budget", "reason"],
    },
  };
}

async function callClaude(env, payload) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, ...payload }),
  });
  return r.json();
}

function pageText(html) {
  const ld = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].trim()).join("\n").slice(0, 6000);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1].trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  const windows = [];
  const re = /(dimensions?|overall|width|depth|height|length|diameter|seat height)/gi;
  let m, last = -1000;
  while ((m = re.exec(text)) && windows.join(" ").length < 7000) {
    if (m.index - last > 250) { windows.push(text.slice(Math.max(0, m.index - 100), m.index + 300)); last = m.index; }
  }
  return `TITLE: ${title}\nSTRUCTURED DATA: ${ld}\nPAGE TEXT: ${text.slice(0, 1500)}\nSIZE SNIPPETS: ${windows.join(" | ")}`.slice(0, 15000);
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const ok = ALLOWED.includes(origin) || origin.endsWith(".app.github.dev") || origin.startsWith("http://localhost");
    const cors = {
      "Access-Control-Allow-Origin": ok ? origin : ALLOWED[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const json = (obj) => new Response(JSON.stringify(obj), { headers: { ...cors, "content-type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!ok || req.method !== "POST") return new Response("Not allowed", { status: 403, headers: cors });

    let body = {};
    try { body = await req.json(); } catch (e) {}

    /* Mode 2: read a furniture size from a product link */
    if (body.url) {
      let u;
      try { u = new URL(String(body.url)); } catch (e) { return json({ error: "bad link" }); }
      if (!/^https?:$/.test(u.protocol) || u.hostname === "localhost" || /^[\d.:\[]/.test(u.hostname) || !u.hostname.includes(".")) {
        return json({ error: "bad link" });
      }
      const viaClaude = async (why) => {
        const j = await browseForSize(env, u.toString()).catch(() => null);
        if (j && j.width_in > 0 && j.depth_in > 0) return json({ ...j, via: "claude-browse" });
        return json({ error: why === "blocked" ? "blocked" : "no size" });
      };
      let html = "";
      try {
        const pr = await fetch(u.toString(), {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "follow",
        });
        if (!pr.ok) return viaClaude("blocked");
        html = (await pr.text()).slice(0, 1500000);
      } catch (e) { return viaClaude("blocked"); }
      const txt = pageText(html);
      if (txt.length < 300) return viaClaude("blocked");
      const data = await callClaude(env, { max_tokens: 400, system: SIZE_SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: txt }] }] });
      const out = data.content?.find((b) => b.type === "text")?.text || "";
      let j = null; try { j = JSON.parse((out.match(/\{[\s\S]*\}/) || [""])[0]); } catch (e) { j = null; }
      if (j && j.width_in > 0 && j.depth_in > 0) return json(j);
      return viaClaude("no size");     // the page loaded but didn't show its sizes as text
    }

    /* Mode 3: find furniture already standing in a room photo */
    if (body.find) {
      const img = typeof body.image === "string" && body.image.length < 2000000 && /^[A-Za-z0-9+/=]+$/.test(body.image) ? body.image : null;
      if (!img) return json({ error: "no image" });
      const kinds = (Array.isArray(body.kinds) ? body.kinds : []).filter((k) => typeof k === "string" && /^[a-z]{2,12}$/.test(k)).slice(0, 20);
      const data = await callClaude(env, {
        max_tokens: 1200, system: FIND_SYSTEM, tools: [findTool(kinds.length ? kinds : ["sofa", "bed", "table", "chair", "desk", "dresser", "storage", "tv", "other"])],
        tool_choice: { type: "tool", name: "found" },
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } }, { type: "text", text: "List the furniture on the floor." }] }],
      });
      const call = data.content?.find((b) => b.type === "tool_use");
      return json(call && call.input ? call.input : { error: "no reply", raw: JSON.stringify(data).slice(0, 300) });
    }

    /* Mode 1: read a vibe from words and photos */
    const text = String(body.text || "").slice(0, 1000);
    const sent = (Array.isArray(body.styles) ? body.styles : []).filter((s) => typeof s === "string" && s.length > 0 && s.length <= 40).slice(0, 120);
    const styles = sent.length >= 5 ? [...new Set(sent)] : DEFAULT_STYLES;
    const images = (Array.isArray(body.images) ? body.images : [])
      .filter((d) => typeof d === "string" && d.length < 2000000 && /^[A-Za-z0-9+/=]+$/.test(d))
      .slice(0, 3);
    const content = images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
    content.push({ type: "text", text: text || "No description was written. Judge only from the photos." });
    const data = await callClaude(env, {
      max_tokens: 800,
      system: STYLE_SYSTEM,
      tools: [vibeTool(styles)],
      tool_choice: { type: "tool", name: "set_vibe" },
      messages: [{ role: "user", content }],
    });
    const call = data.content?.find((b) => b.type === "tool_use");
    if (call && call.input) return json(call.input);
    const out = data.content?.find((b) => b.type === "text")?.text;
    if (out) return new Response(out, { headers: { ...cors, "content-type": "application/json" } });
    return json({ error: "no reply", raw: JSON.stringify(data).slice(0, 400) });
  },
};
