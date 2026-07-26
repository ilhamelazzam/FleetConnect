from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field

import httpx

from app.core.config import get_settings
from app.services.chat_service import (
    ImageAnalysisTimeoutError,
    LocalModelUnavailableError,
    VisionUnavailableError,
)

VISION_LOGGER = logging.getLogger("app.chat.vision")

VISION_VISIBLE_WIFI_ROUTER_LABEL = "Routeur Wi-Fi apparent"
VISION_VISIBLE_NETWORK_ANTENNAS_LABEL = "Antennes reseau visibles"
VISION_VISIBLE_NETWORK_CHASSIS_LABEL = "Boitier reseau visible"
VISION_VISIBLE_NETWORK_PORTS_LABEL = "Voyants ou ports apparents"

VISION_ROUTER_KEYWORDS = (
    "router",
    "routeur",
    "modem routeur",
    "routeur modem",
    "modem or router",
    "router or modem",
    "modem router",
    "router modem",
    "wifi router",
    "wi fi router",
    "wireless router",
    "network router",
    "gateway",
    "cpe",
)

VISION_NETWORK_DEVICE_KEYWORDS = (
    "network device",
    "networking device",
    "equipement de reseau",
    "equipement reseau",
    "equipement de reseau informatique",
    "equipement reseau informatique",
    "device reseau",
    "network equipment",
    "router chassis",
    "router body",
    "network chassis",
    "network box",
    "network body",
    "boitier reseau",
)

VISION_PORTS_KEYWORDS = (
    "ethernet port",
    "ethernet ports",
    "ports ethernet",
    "network port",
    "network ports",
    "lan port",
    "lan ports",
    "ports visible",
    "visible ports",
    "visible port",
    "port visible",
)

VISION_ANTENNA_KEYWORDS = (
    "multiple antennas",
    "wifi antennas",
    "wi fi antennas",
    "network antennas",
    "antennas",
    "antennas",
    "antenna",
    "multiple antennes",
    "antennes wifi",
    "antennes wi fi",
    "antennes reseau",
    "antennes",
    "antenne",
)

VISION_ROUTER_RELATED_OBJECT_TERMS = (
    *VISION_ROUTER_KEYWORDS,
    *VISION_NETWORK_DEVICE_KEYWORDS,
    *VISION_PORTS_KEYWORDS,
    *VISION_ANTENNA_KEYWORDS,
    "modem usb",
    "usb modem",
    "dongle",
    "borne wifi",
    "access point",
    "wifi hotspot",
    "telecom antenna",
    "antenne telecom",
    "switch",
    "ethernet cable",
    "network cable",
    "cable reseau",
    "ports",
    "port",
)

VISION_NON_ROUTER_COMPANION_TERMS = (
    "smartphone",
    "telephone",
    "phone",
    "iphone",
    "android phone",
    "tablet",
    "ipad",
    "ordinateur",
    "computer",
    "laptop",
    "notebook",
    "pc",
    "printer",
    "imprimante",
    "serveur",
    "server",
    "vehicule",
    "vehicle",
    "voiture",
    "car",
    "truck",
    "camion",
    "wheel",
    "roue",
    "carte sim",
    "sim card",
    "sim cards",
    "nano sim",
    "micro sim",
    "mini sim",
    "esim",
    "e sim",
)


@dataclass(frozen=True)
class VisionRadarAxis:
    key: str
    label: str
    value: int | None


@dataclass(frozen=True)
class VisionAnalysisResult:
    image_type: str
    analysis: str
    detected_kpis: list[str]
    recommendations: list[str]
    confidence: float
    model: str
    detected_objects: list[str] = field(default_factory=list)
    detected_brands: list[str] = field(default_factory=list)
    detected_operators: list[str] = field(default_factory=list)
    sim_types: list[str] = field(default_factory=list)
    primary_equipment: str | None = None
    apparent_condition: str | None = None
    probable_usage: str | None = None
    replacement_signals: list[str] = field(default_factory=list)
    widgets: list[str] = field(default_factory=list)
    charts: list[str] = field(default_factory=list)
    critical_zones: list[str] = field(default_factory=list)
    radar_axes: list[VisionRadarAxis] = field(default_factory=list)
    raw_output: str = ""


@dataclass(frozen=True)
class ParsedLlavaObject:
    raw_label: str
    object_type: str | None = None
    brand: str | None = None


def _build_vision_timeout(timeout_seconds: float | None = None) -> httpx.Timeout:
    settings = get_settings()
    resolved_timeout = timeout_seconds or settings.ollama_vision_timeout_seconds
    return httpx.Timeout(
        timeout=resolved_timeout,
        connect=3.0,
        write=10.0,
        read=resolved_timeout,
    )


def _post_ollama_generate(
    request_url: str,
    payload: dict[str, object],
    *,
    timeout_seconds: float | None = None,
) -> httpx.Response:
    with httpx.Client(timeout=_build_vision_timeout(timeout_seconds)) as client:
        return client.post(request_url, json=payload)


def _ns_to_ms(value: object) -> int | None:
    if value is None:
        return None
    try:
        return round(float(value) / 1_000_000)
    except (TypeError, ValueError):
        return None


def _get_ollama_tags(tags_url: str) -> httpx.Response:
    with httpx.Client(
        timeout=httpx.Timeout(timeout=5.0, connect=2.0, write=5.0, read=5.0)
    ) as client:
        return client.get(tags_url)


def _handle_vision_error(payload: dict[str, object], status_code: int) -> None:
    settings = get_settings()
    vision_model = settings.ollama_vision_model
    error_detail = str(payload.get("error") or "").strip()
    if status_code == 404 or "model" in error_detail.lower():
        raise VisionUnavailableError(
            f"Le modele vision `{vision_model}` est indisponible. Executez `ollama pull {vision_model}`.",
        )

    if "connection" in error_detail.lower() or "refused" in error_detail.lower():
        raise LocalModelUnavailableError(
            "Ollama non lance ou inaccessible.",
            log_message=(
                f"Le modele vision {vision_model} n'est pas disponible. "
                f"Executez `ollama pull {vision_model}` puis reessayez."
            ),
        )

    raise VisionUnavailableError(
        "LLaVA indisponible.",
    )


def _parse_bullet_block(prefix: str, text: str) -> list[str]:
    match = re.search(
        rf"{prefix}\s*:\s*(.*?)(?:\n[A-Z_ ]+\s*:|\Z)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return []

    block = match.group(1).strip()
    lines = [re.sub(r"^(?:[-*•]|\d+\.)\s*", "", line).strip() for line in block.splitlines()]
    return [line for line in lines if line][:8]


def _extract_section_block(prefix: str, text: str) -> str:
    match = re.search(
        rf"{prefix}\s*:\s*(.*?)(?:\n[A-Z_ ]+\s*:|\Z)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    return match.group(1).strip()


def _parse_list_or_inline_block(prefix: str, text: str, *, limit: int = 8) -> list[str]:
    block = _extract_section_block(prefix, text)
    if not block:
        return []

    raw_items: list[str] = []
    for line in block.splitlines():
        normalized_line = re.sub(r"^(?:[-*â€¢]|\d+\.)\s*", "", line).strip()
        if not normalized_line:
            continue
        raw_items.extend(
            item.strip(" -")
            for item in re.split(r"[;,]\s*", normalized_line)
            if item.strip(" -")
        )

    if not raw_items:
        raw_items = [
            item.strip(" -")
            for item in re.split(r"[;,]\s*", block)
            if item.strip(" -")
        ]

    items: list[str] = []
    seen = set()
    for item in raw_items:
        normalized_key = " ".join(item.lower().split())
        if normalized_key in {"", "aucun", "aucune", "none", "n/a", "inconnu"}:
            continue
        if normalized_key in seen:
            continue
        seen.add(normalized_key)
        items.append(item)
        if len(items) >= limit:
            break
    return items


def _parse_single_value(prefix: str, text: str) -> str | None:
    block = _extract_section_block(prefix, text)
    if not block:
        return None
    first_line = re.sub(r"^(?:[-*â€¢]|\d+\.)\s*", "", block.splitlines()[0]).strip()
    if not first_line:
        return None
    normalized_line = " ".join(first_line.lower().split())
    if normalized_line in {"aucun", "aucune", "none", "n/a", "inconnu"}:
        return None
    return first_line


def _parse_confidence(text: str) -> float:
    match = re.search(r"CONFIDENCE\s*:\s*([01](?:[.,]\d+)?)", text, flags=re.IGNORECASE)
    if not match:
        return 0.7

    value = match.group(1).replace(",", ".")
    try:
        return max(0.0, min(float(value), 1.0))
    except ValueError:
        return 0.7


def _parse_image_type(text: str) -> str:
    match = re.search(
        r"(?:TYPE_IMAGE|Type d'image|Type image)\s*:\s*([^\n]+)",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return "capture_interface"

    return (
        match.group(1)
        .strip()
        .lower()
        .replace(" ", "_")
        .replace("-", "_")
    )


def _normalize_vision_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text or "")
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    return " ".join(
        ascii_text.lower()
        .replace("/", " ")
        .replace("-", " ")
        .replace("_", " ")
        .split()
    )


def _dedupe_detected_objects(items: list[str], *, limit: int = 8) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for item in items:
        normalized_item = _normalize_vision_text(item)
        if not normalized_item or normalized_item in seen:
            continue
        seen.add(normalized_item)
        deduped.append(item)
        if len(deduped) >= limit:
            break
    return deduped


def _find_vision_keywords(normalized_text: str, keywords: tuple[str, ...]) -> list[str]:
    return _dedupe_detected_objects(
        [keyword for keyword in keywords if keyword in normalized_text],
        limit=len(keywords),
    )


def _router_profile_terms_detected(normalized_text: str) -> bool:
    return bool(
        _find_vision_keywords(normalized_text, VISION_ROUTER_KEYWORDS)
        or _find_vision_keywords(normalized_text, VISION_NETWORK_DEVICE_KEYWORDS)
    )


def _is_router_related_detected_object(raw_label: str) -> bool:
    normalized_label = _normalize_vision_text(raw_label)
    return any(term in normalized_label for term in VISION_ROUTER_RELATED_OBJECT_TERMS)


def _raw_vision_has_non_router_companion_objects(
    *,
    normalized_text: str,
    parsed_objects: list[str],
) -> bool:
    if any(term in normalized_text for term in VISION_NON_ROUTER_COMPANION_TERMS):
        return True
    return any(not _is_router_related_detected_object(item) for item in parsed_objects if item)


def _raw_vision_mentions_antennas(normalized_text: str) -> bool:
    return bool(_find_vision_keywords(normalized_text, VISION_ANTENNA_KEYWORDS))


def _raw_vision_mentions_ports(normalized_text: str) -> bool:
    return bool(_find_vision_keywords(normalized_text, VISION_PORTS_KEYWORDS))


def _normalize_llava_object_type(value: object) -> str | None:
    normalized_type = _normalize_vision_text(str(value or ""))
    return normalized_type or None


def _build_llava_object_raw_label(
    *,
    object_type: str | None,
    brand: str | None,
    raw_object: dict[str, object],
) -> str:
    if object_type == "router":
        return f"Router {brand}".strip() if brand else "Router"
    if object_type:
        readable_type = object_type.replace("_", " ")
        return f"{readable_type} {brand}".strip() if brand else readable_type
    label_candidates = [
        raw_object.get("label"),
        raw_object.get("name"),
        raw_object.get("type"),
    ]
    for candidate in label_candidates:
        normalized_candidate = str(candidate or "").strip()
        if normalized_candidate:
            return normalized_candidate
    return str(raw_object).strip()


def _parse_llava_object(raw_object: object) -> ParsedLlavaObject:
    if isinstance(raw_object, dict):
        raw_type = _normalize_llava_object_type(raw_object.get("type"))
        raw_brand = str(raw_object.get("brand") or "").strip() or None
        return ParsedLlavaObject(
            raw_label=_build_llava_object_raw_label(
                object_type=raw_type,
                brand=raw_brand,
                raw_object=raw_object,
            ),
            object_type=raw_type,
            brand=raw_brand,
        )

    raw_label = str(raw_object).strip()
    return ParsedLlavaObject(raw_label=raw_label)


def _extract_network_equipment_objects_from_raw_response(
    *,
    normalized_text: str,
    parsed_objects: list[str],
    prompt_profile: str,
) -> tuple[list[str], dict[str, list[str]]]:
    if prompt_profile != "physical_objects":
        return [], {
            "ROUTER_KEYWORDS_FOUND": [],
            "PORTS_KEYWORDS_FOUND": [],
            "ANTENNA_KEYWORDS_FOUND": [],
            "NETWORK_DEVICE_KEYWORDS_FOUND": [],
        }

    router_keywords_found = _find_vision_keywords(normalized_text, VISION_ROUTER_KEYWORDS)
    ports_keywords_found = _find_vision_keywords(normalized_text, VISION_PORTS_KEYWORDS)
    antenna_keywords_found = _find_vision_keywords(normalized_text, VISION_ANTENNA_KEYWORDS)
    network_device_keywords_found = _find_vision_keywords(
        normalized_text,
        VISION_NETWORK_DEVICE_KEYWORDS,
    )
    keyword_matches = {
        "ROUTER_KEYWORDS_FOUND": router_keywords_found,
        "PORTS_KEYWORDS_FOUND": ports_keywords_found,
        "ANTENNA_KEYWORDS_FOUND": antenna_keywords_found,
        "NETWORK_DEVICE_KEYWORDS_FOUND": network_device_keywords_found,
    }

    if not (router_keywords_found or network_device_keywords_found):
        return [], keyword_matches
    if _raw_vision_has_non_router_companion_objects(
        normalized_text=normalized_text,
        parsed_objects=parsed_objects,
    ):
        return [], keyword_matches

    detected_objects = [VISION_VISIBLE_WIFI_ROUTER_LABEL]
    if antenna_keywords_found or _raw_vision_mentions_antennas(normalized_text):
        detected_objects.append(VISION_VISIBLE_NETWORK_ANTENNAS_LABEL)
    if router_keywords_found or network_device_keywords_found:
        detected_objects.append(VISION_VISIBLE_NETWORK_CHASSIS_LABEL)
    if ports_keywords_found or _raw_vision_mentions_ports(normalized_text):
        detected_objects.append(VISION_VISIBLE_NETWORK_PORTS_LABEL)
    return _dedupe_detected_objects(detected_objects), keyword_matches


def _parse_json_response(raw_analysis: str) -> dict[str, object] | None:
    stripped_analysis = raw_analysis.strip()
    if not stripped_analysis:
        return None

    candidates = [stripped_analysis]
    if stripped_analysis.startswith("```"):
        fence_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", stripped_analysis, flags=re.DOTALL)
        if fence_match:
            candidates.insert(0, fence_match.group(1).strip())
    first_brace = stripped_analysis.find("{")
    last_brace = stripped_analysis.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidates.insert(0, stripped_analysis[first_brace : last_brace + 1].strip())

    for candidate in candidates:
        try:
            parsed_candidate = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed_candidate, dict):
            return parsed_candidate
    return None


def _parse_llava_objects_from_json_response(
    raw_analysis: str,
) -> list[ParsedLlavaObject]:
    parsed_json = _parse_json_response(raw_analysis)
    if parsed_json is None:
        return []
    raw_objects = parsed_json.get("detected_objects")
    if not isinstance(raw_objects, list):
        raw_objects = parsed_json.get("objects")
    if not isinstance(raw_objects, list):
        return []
    parsed_objects: list[ParsedLlavaObject] = []
    seen_labels: set[str] = set()
    for item in raw_objects:
        parsed_object = _parse_llava_object(item)
        normalized_label = _normalize_vision_text(parsed_object.raw_label)
        if not normalized_label or normalized_label in seen_labels:
            continue
        seen_labels.add(normalized_label)
        parsed_objects.append(parsed_object)
        if len(parsed_objects) >= 8:
            break
    return parsed_objects


def _parse_objects_from_json_response(
    raw_analysis: str,
) -> list[str]:
    return [
        parsed_object.raw_label
        for parsed_object in _parse_llava_objects_from_json_response(raw_analysis)
    ]


def _parse_brands_from_json_response(raw_analysis: str) -> list[str]:
    parsed_json = _parse_json_response(raw_analysis)
    if parsed_json is None:
        return []
    brands: list[str] = []
    top_level_brand = str(parsed_json.get("brand") or "").strip()
    if top_level_brand:
        brands.append(top_level_brand)
    raw_objects = parsed_json.get("detected_objects")
    if not isinstance(raw_objects, list):
        raw_objects = parsed_json.get("objects")
    if not isinstance(raw_objects, list):
        return _dedupe_detected_objects(brands, limit=8)
    for item in raw_objects:
        if not isinstance(item, dict):
            continue
        brand = str(item.get("brand") or "").strip()
        if brand:
            brands.append(brand)
    return _dedupe_detected_objects(brands, limit=8)


def _parse_equipment_type_from_json_response(raw_analysis: str) -> str | None:
    parsed_json = _parse_json_response(raw_analysis)
    if parsed_json is None:
        return None
    for key in ("equipment_type", "primary_equipment", "type"):
        value = str(parsed_json.get(key) or "").strip()
        if value:
            return value
    return None


def _parse_confidence_from_json_response(raw_analysis: str) -> float | None:
    parsed_json = _parse_json_response(raw_analysis)
    if parsed_json is None:
        return None
    raw_confidence = parsed_json.get("confidence")
    try:
        return max(0.0, min(float(raw_confidence), 1.0))
    except (TypeError, ValueError):
        return None


def _derive_focus_hint(question: str) -> str:
    normalized_question = question.lower()
    hints: list[str] = []
    if any(keyword in normalized_question for keyword in ("facture", "invoice", "tva", "montant")):
        hints.append("facture, montants, taxes, depassements")
    if any(keyword in normalized_question for keyword in ("alerte", "fraude", "suspect", "log", "incident")):
        hints.append("alerte, gravite, ligne, fraude, erreur")
    if any(keyword in normalized_question for keyword in ("workflow", "processus", "organigramme", "schema")):
        hints.append("etapes, validations, dependances, blocages")
    if any(keyword in normalized_question for keyword in ("equipement", "routeur", "smartphone", "modem", "sim")):
        hints.append("equipement, marque, modele, etat")
    if any(keyword in normalized_question for keyword in ("ux", "interface", "dashboard", "ecran", "chatbot")):
        hints.append("lisibilite, kpi, boutons, contraste")
    if not hints:
        hints.append("objets visibles, etat apparent, environnement, elements structurants")
    return "; ".join(hints[:3])


def _question_targets_physical_objects(question: str) -> bool:
    normalized_question = _normalize_vision_text(question)
    physical_keywords = (
        "equipement",
        "equipements",
        "materiel",
        "objet",
        "objets",
        "appareil",
        "smartphone",
        "telephone",
        "routeur",
        "router",
        "modem",
        "sim",
        "carte sim",
        "cle 4g",
        "cle 5g",
        "dongle",
        "switch",
        "telephone ip",
        "ip phone",
        "antenne",
        "antenna",
        "borne wifi",
        "point d acces wi fi",
        "point d acces wifi",
        "access point",
        "vehicule",
        "vehicle",
        "voiture",
        "car",
        "camion",
        "roue",
        "carrosserie",
        "ordinateur",
        "ecran",
        "clavier",
        "machine",
        "imprimante",
        "serveur",
    )
    physical_phrases = (
        "quels equipements sont visibles",
        "quels objets sont visibles",
        "a quoi servent",
        "role de chaque equipement",
        "fonction des equipements",
        "analyse le materiel",
        "inventaire du materiel",
        "decris les objets visibles",
    )
    return any(keyword in normalized_question for keyword in physical_keywords) or any(
        phrase in normalized_question for phrase in physical_phrases
    )


def _question_mentions_vehicle(question: str) -> bool:
    normalized_question = _normalize_vision_text(question)
    return any(
        keyword in normalized_question
        for keyword in ("vehicule", "vehicle", "voiture", "berline", "compacte", "carrosserie", "roue")
    )


def _resolve_vision_prompt_profile_context(
    question: str,
    *,
    analysis_mode: str | None = None,
    prompt_profile_override: str | None = None,
    question_type: str | None = None,
    image_type: str | None = None,
    vision_routing: str | None = None,
) -> tuple[str, str]:
    normalized_image_type = _normalize_vision_text(image_type or "")
    normalized_vision_routing = _normalize_vision_text(vision_routing or "")
    if question_type == "EQUIPMENT_DETECTION":
        return "physical_objects", "equipment_detection"
    if normalized_image_type == "equipement":
        return "physical_objects", "image_type_equipment"
    if normalized_vision_routing == "equipment":
        return "physical_objects", "vision_routing_equipment"
    if prompt_profile_override == "physical_objects":
        return "physical_objects", "prompt_profile_override"
    if prompt_profile_override:
        return prompt_profile_override, "prompt_profile_override"
    if _question_targets_physical_objects(question):
        return "physical_objects", "question_targets_physical_objects"
    if analysis_mode in {"dashboard_analysis", "advanced"}:
        return "business_visual", "analysis_mode_business_visual"
    return "general_visual", "default_general_visual"


def _resolve_vision_prompt_profile(
    question: str,
    *,
    analysis_mode: str | None = None,
    prompt_profile_override: str | None = None,
    question_type: str | None = None,
    image_type: str | None = None,
    vision_routing: str | None = None,
) -> str:
    prompt_profile, _profile_reason = _resolve_vision_prompt_profile_context(
        question,
        analysis_mode=analysis_mode,
        prompt_profile_override=prompt_profile_override,
        question_type=question_type,
        image_type=image_type,
        vision_routing=vision_routing,
    )
    return prompt_profile


def _build_physical_objects_prompt() -> str:
    return (
        "Identify only the physical objects directly visible in this telecom image.\n\n"
        "Rules:\n"
        "- Never invent equipment.\n"
        "- Never infer an accessory that is not visible.\n"
        "- List only objects that are really present.\n"
        "- If uncertain, use Objet non identifie avec certitude.\n\n"
        "Recognize when clearly visible: Routeur Wi-Fi, Modem USB, Carte SIM, Smartphone, "
        "Switch reseau, Telephone IP, Antenne reseau, Point d'acces Wi-Fi.\n\n"
        "Return JSON only:\n"
        '{"detected_objects":[],"equipment_type":"inconnu","brand":"inconnu","confidence":0.0}'
    )


def _build_vision_prompt(
    question: str,
    *,
    analysis_mode: str | None = None,
    prompt_profile_override: str | None = None,
    question_type: str | None = None,
    image_type: str | None = None,
    vision_routing: str | None = None,
) -> str:
    if _resolve_vision_prompt_profile(
        question,
        analysis_mode=analysis_mode,
        prompt_profile_override=prompt_profile_override,
        question_type=question_type,
        image_type=image_type,
        vision_routing=vision_routing,
    ) == "physical_objects":
        return _build_physical_objects_prompt()

    focus_hint = _derive_focus_hint(question)
    dashboard_rules = (
        "Si c'est un dashboard, detecte les widgets visibles et donne les sous-scores radar "
        "les plus plausibles en entier de 0 a 100. Si une valeur est vraiment invisible, ecris inconnu.\n"
    )
    if analysis_mode == "dashboard_analysis":
        dashboard_rules += (
            "Priorite absolue: radar chart, KPI cards, gauges, alert cards, bar charts et line charts.\n"
        )
    return (
        "Analyse uniquement ce qui est visible sur l'image.\n"
        f"Question: {question.strip()}\n"
        f"Mode: {(analysis_mode or 'advanced').strip()}\n"
        f"{dashboard_rules}"
        "N'affirme un type, une marque ou un modele que si l'element est visuellement plausible.\n"
        "Si un objet reste ambigu, ecris 'Objet non identifie avec certitude'.\n"
        "Ne recommande jamais un remplacement materiel, un routeur 5G ou un smartphone neuf sans signe visuel explicite.\n"
        "Reponds exactement avec:\n"
        "TYPE_IMAGE: <mot simple>\n"
        "CONFIDENCE: <0.00 a 1.00>\n"
        "DETECTED_OBJECTS:\n"
        "- <max 8 objets telecom physiques visibles, prudents, ou Objet non identifie avec certitude>\n"
        "BRANDS:\n"
        "- <marques visibles ou Aucun>\n"
        "OPERATORS:\n"
        "- <operateurs visibles sur la photo ou Aucun>\n"
        "SIM_TYPES:\n"
        "- <nano sim | micro sim | mini sim | esim | inconnu>\n"
        "PRIMARY_EQUIPMENT: <equipement principal visible ou Aucun>\n"
        "APPARENT_CONDITION: <fonctionnel | usage normal | endommage | obsolete | inconnu>\n"
        "PROBABLE_USAGE: <usage probable ou inconnu>\n"
        "REPLACEMENT_SIGNALS:\n"
        "- <max 4 signaux visibles de remplacement reel (casse, batterie gonflee, surchauffe, obsolescence visible) ou Aucun>\n"
        "WIDGETS:\n"
        "- <radar chart | bar chart | line chart | kpi card | gauge | alert card | table | inconnu>\n"
        "CHARTS:\n"
        "- <chart type visible>\n"
        "KPI:\n"
        "- <max 4 elements>\n"
        "RADAR_AXES:\n"
        "- Workflow=<0-100|inconnu>\n"
        "- Equipements=<0-100|inconnu>\n"
        "- Fraude=<0-100|inconnu>\n"
        "- Couts=<0-100|inconnu>\n"
        "- Anomalies=<0-100|inconnu>\n"
        "- Optimisation=<0-100|inconnu>\n"
        "- Risque=<0-100|inconnu>\n"
        "- Roaming=<0-100|inconnu>\n"
        "CRITICAL_ZONES:\n"
        "- <max 4 zones faibles ou desequilibres>\n"
        "RECOMMANDATIONS:\n"
        "- <max 4 actions>\n"
        "ANALYSE:\n"
        "<3 phrases courtes maximum, basees sur des elements visibles. "
        "Si radar: parler de desequilibre, axe dominant, axe faible, asymetrie. "
        "Si courbe: signaler hausse, pic, rupture ou degradation progressive seulement si cela semble visible. "
        "Si bar chart: signaler concentration, ecart ou poste dominant seulement si c'est visible. "
        "Si dashboard: mentionner surcharge visuelle, lisibilite ou KPI critiques si ces signaux sont visibles.>\n"
        f"Focus: {focus_hint}"
    )


def _normalize_axis_key(value: str) -> tuple[str, str] | None:
    normalized = (
        value.strip()
        .lower()
        .replace("é", "e")
        .replace("è", "e")
        .replace("ê", "e")
        .replace("û", "u")
        .replace("ô", "o")
    )
    axis_map = {
        "workflow": ("workflow_score", "Workflow"),
        "workflows": ("workflow_score", "Workflow"),
        "equipements": ("equipment_score", "Equipements"),
        "equipement": ("equipment_score", "Equipements"),
        "equipment": ("equipment_score", "Equipements"),
        "fraude": ("fraud_score", "Fraude"),
        "fraud": ("fraud_score", "Fraude"),
        "couts": ("cost_score", "Couts"),
        "cout": ("cost_score", "Couts"),
        "cost": ("cost_score", "Couts"),
        "anomalies": ("anomaly_score", "Anomalies"),
        "anomalie": ("anomaly_score", "Anomalies"),
        "optimisation": ("optimization_score", "Optimisation"),
        "optimization": ("optimization_score", "Optimisation"),
        "risque": ("risk_score", "Risque"),
        "risk": ("risk_score", "Risque"),
        "roaming": ("roaming_score", "Roaming"),
    }
    for candidate, axis in axis_map.items():
        if candidate in normalized:
            return axis
    return None


def _parse_radar_axes(text: str) -> list[VisionRadarAxis]:
    radar_lines = _parse_bullet_block("RADAR_AXES", text)
    axes: list[VisionRadarAxis] = []
    for line in radar_lines:
        if "=" not in line:
            continue
        raw_label, raw_value = line.split("=", 1)
        axis_info = _normalize_axis_key(raw_label)
        if axis_info is None:
            continue
        axis_key, axis_label = axis_info
        normalized_value = raw_value.strip().lower().replace("%", "").replace("/100", "")
        if normalized_value in {"inconnu", "unknown", "n/a", ""}:
            parsed_value = None
        else:
            match = re.search(r"(\d{1,3})", normalized_value)
            parsed_value = None
            if match:
                try:
                    parsed_value = max(0, min(int(match.group(1)), 100))
                except ValueError:
                    parsed_value = None
        axes.append(
            VisionRadarAxis(
                key=axis_key,
                label=axis_label,
                value=parsed_value,
            )
        )
    return axes[:8]


async def is_vision_model_available() -> tuple[bool, str | None]:
    settings = get_settings()
    tags_url = f"{settings.ollama_base_url.rstrip('/')}/api/tags"
    try:
        response = await asyncio.to_thread(_get_ollama_tags, tags_url)
    except (httpx.TimeoutException, httpx.RequestError, OSError):
        return False, "Ollama non lance ou inaccessible."

    try:
        payload = response.json()
    except ValueError:
        return False, "Ollama a retourne une reponse invalide."

    models = payload.get("models")
    if not isinstance(models, list):
        return False, "Ollama a retourne une liste de modeles invalide."

    expected_name = settings.ollama_vision_model.strip().lower()
    available_names = {
        str(item.get("name") or item.get("model") or "").strip().lower()
        for item in models
        if isinstance(item, dict)
    }
    if any(name == expected_name or name.startswith(f"{expected_name}:") for name in available_names):
        return True, None

    return (
        False,
        (
            f"Le modele vision `{settings.ollama_vision_model}` est absent. "
            f"Executez `ollama pull {settings.ollama_vision_model}`."
        ),
    )


async def analyze_image_with_llava(
    *,
    question: str,
    image_base64: str,
    timeout_seconds: int | None = None,
    analysis_mode: str | None = None,
    prompt_profile_override: str | None = None,
    question_type: str | None = None,
    image_type: str | None = None,
    vision_routing: str | None = None,
) -> VisionAnalysisResult:
    overall_started_at = time.perf_counter()
    settings = get_settings()
    request_url = f"{settings.ollama_base_url.rstrip('/')}/api/generate"
    prompt = _build_vision_prompt(
        question,
        analysis_mode=analysis_mode,
        prompt_profile_override=prompt_profile_override,
        question_type=question_type,
        image_type=image_type,
        vision_routing=vision_routing,
    )
    prompt_profile, prompt_profile_reason = _resolve_vision_prompt_profile_context(
        question,
        analysis_mode=analysis_mode,
        prompt_profile_override=prompt_profile_override,
        question_type=question_type,
        image_type=image_type,
        vision_routing=vision_routing,
    )
    num_predict = 32 if prompt_profile == "physical_objects" else 96
    top_p = 0.8 if prompt_profile == "physical_objects" else 0.35
    VISION_LOGGER.info("VISION_PROFILE_SELECTED=%s", prompt_profile)
    VISION_LOGGER.info("VISION_PROFILE_REASON=%s", prompt_profile_reason)
    VISION_LOGGER.info("QUESTION_TYPE=%s", question_type or "STANDARD")
    VISION_LOGGER.info("IMAGE_TYPE=%s", image_type or "unknown")
    VISION_LOGGER.info("VISION_ROUTING=%s", vision_routing or "STANDARD")
    VISION_LOGGER.info("VISION_NUM_PREDICT=%s", num_predict)
    VISION_LOGGER.info("VISION_PROMPT_CHARS=%s", len(prompt))

    payload = {
        "model": settings.ollama_vision_model,
        "prompt": prompt,
        "stream": False,
        "images": [image_base64],
        "options": {
            "temperature": 0.1,
            "top_p": top_p,
            "num_predict": num_predict,
        },
    }

    last_error: Exception | None = None
    for attempt in range(get_settings().ollama_vision_retry_count + 1):
        started_at = time.perf_counter()
        VISION_LOGGER.info(
            "event=vision_request_started model=%s attempt=%s prompt_profile=%s timeout_seconds=%s prompt_chars=%s image_base64_chars=%s num_predict=%s",
            settings.ollama_vision_model,
            attempt + 1,
            prompt_profile,
            timeout_seconds or settings.ollama_vision_timeout_seconds,
            len(prompt),
            len(image_base64),
            num_predict,
        )
        try:
            response = await asyncio.to_thread(
                _post_ollama_generate,
                request_url,
                payload,
                timeout_seconds=timeout_seconds,
            )
            request_duration_ms = round((time.perf_counter() - started_at) * 1000)
            VISION_LOGGER.info("VISION_REQUEST_DURATION_MS=%s", request_duration_ms)
            VISION_LOGGER.info(
                "event=vision_response_received model=%s attempt=%s status=%s duration_ms=%s timeout_seconds=%s",
                settings.ollama_vision_model,
                attempt + 1,
                response.status_code,
                request_duration_ms,
                timeout_seconds or settings.ollama_vision_timeout_seconds,
            )
            break
        except httpx.TimeoutException as exc:
            last_error = exc
            request_duration_ms = round((time.perf_counter() - started_at) * 1000)
            VISION_LOGGER.info("VISION_REQUEST_DURATION_MS=%s", request_duration_ms)
            VISION_LOGGER.info("VISION_TOTAL_DURATION_MS=%s", request_duration_ms)
            VISION_LOGGER.warning(
                "event=vision_timeout model=%s attempt=%s duration_ms=%s timeout_seconds=%s prompt_profile=%s prompt_chars=%s image_base64_chars=%s num_predict=%s",
                settings.ollama_vision_model,
                attempt + 1,
                request_duration_ms,
                timeout_seconds or settings.ollama_vision_timeout_seconds,
                prompt_profile,
                len(prompt),
                len(image_base64),
                num_predict,
            )
            if attempt >= get_settings().ollama_vision_retry_count:
                raise ImageAnalysisTimeoutError() from exc
        except (httpx.RequestError, OSError) as exc:
            VISION_LOGGER.warning(
                "event=vision_network_error model=%s attempt=%s error=%s",
                settings.ollama_vision_model,
                attempt + 1,
                exc.__class__.__name__,
            )
            raise LocalModelUnavailableError(
                "Ollama non lance ou inaccessible.",
                log_message=(
                    f"Le modele vision {settings.ollama_vision_model} n'est pas joignable via Ollama."
                ),
            ) from exc
    else:  # pragma: no cover - defensive
        raise ImageAnalysisTimeoutError() from last_error

    try:
        response_payload = response.json()
    except ValueError as exc:
        raise VisionUnavailableError("LLaVA a retourne une reponse invalide.") from exc

    ollama_load_duration_ms = _ns_to_ms(response_payload.get("load_duration"))
    ollama_total_duration_ms = _ns_to_ms(response_payload.get("total_duration"))
    ollama_prompt_eval_duration_ms = _ns_to_ms(response_payload.get("prompt_eval_duration"))
    ollama_eval_duration_ms = _ns_to_ms(response_payload.get("eval_duration"))
    ollama_prompt_eval_count = response_payload.get("prompt_eval_count")
    ollama_eval_count = response_payload.get("eval_count")
    VISION_LOGGER.info(
        "VISION_GENERATION_DURATION_MS=%s",
        ollama_eval_duration_ms,
    )
    VISION_LOGGER.info(
        "event=vision_response_metrics model=%s prompt_profile=%s total_duration_ms=%s load_duration_ms=%s prompt_eval_duration_ms=%s eval_duration_ms=%s prompt_eval_count=%s eval_count=%s",
        settings.ollama_vision_model,
        prompt_profile,
        ollama_total_duration_ms,
        ollama_load_duration_ms,
        ollama_prompt_eval_duration_ms,
        ollama_eval_duration_ms,
        ollama_prompt_eval_count,
        ollama_eval_count,
    )

    if response.status_code >= 400:
        _handle_vision_error(response_payload, response.status_code)

    raw_analysis = str(response_payload.get("response") or "").strip()
    if not raw_analysis:
        raise VisionUnavailableError("LLaVA n'a retourne aucune reponse metier utilisable.")
    VISION_LOGGER.info("RAW_LLAVA_RESPONSE=%s", raw_analysis)

    parsed_llava_objects = _parse_llava_objects_from_json_response(raw_analysis) if prompt_profile == "physical_objects" else []
    parsed_json_objects = [parsed_object.raw_label for parsed_object in parsed_llava_objects]
    parsed_equipment_type = (
        _parse_equipment_type_from_json_response(raw_analysis)
        if prompt_profile == "physical_objects"
        else None
    )
    parsed_detected_objects = parsed_json_objects or _parse_list_or_inline_block("DETECTED_OBJECTS", raw_analysis)
    if not parsed_detected_objects and parsed_equipment_type:
        parsed_detected_objects = [parsed_equipment_type]
    analysis_match = re.search(r"ANALYSE\s*:\s*(.+)$", raw_analysis, flags=re.IGNORECASE | re.DOTALL)
    analysis = (
        (
            f"Objets visibles: {', '.join(parsed_detected_objects)}"
            if parsed_detected_objects
            else raw_analysis
        )
        if prompt_profile == "physical_objects"
        else (analysis_match.group(1).strip() if analysis_match else raw_analysis)
    )
    normalized_vision_text = _normalize_vision_text(
        " ".join(
            item
            for item in [
                raw_analysis,
                parsed_equipment_type or "",
                *parsed_detected_objects,
            ]
            if item
        )
    )
    network_detected_objects, network_keyword_matches = _extract_network_equipment_objects_from_raw_response(
        normalized_text=normalized_vision_text,
        parsed_objects=parsed_detected_objects,
        prompt_profile=prompt_profile,
    )
    VISION_LOGGER.info(
        "ROUTER_KEYWORDS_FOUND=%s",
        network_keyword_matches["ROUTER_KEYWORDS_FOUND"],
    )
    VISION_LOGGER.info(
        "PORTS_KEYWORDS_FOUND=%s",
        network_keyword_matches["PORTS_KEYWORDS_FOUND"],
    )
    VISION_LOGGER.info(
        "ANTENNA_KEYWORDS_FOUND=%s",
        network_keyword_matches["ANTENNA_KEYWORDS_FOUND"],
    )
    VISION_LOGGER.info(
        "NETWORK_DEVICE_KEYWORDS_FOUND=%s",
        network_keyword_matches["NETWORK_DEVICE_KEYWORDS_FOUND"],
    )
    detected_objects = network_detected_objects or parsed_detected_objects
    parsed_image_type = _parse_image_type(raw_analysis)
    if network_detected_objects:
        parsed_image_type = "routeur_wifi"
    elif prompt_profile == "physical_objects" and detected_objects:
        parsed_image_type = "equipement"
    parsed_confidence = _parse_confidence_from_json_response(raw_analysis)
    if parsed_confidence is None:
        parsed_confidence = _parse_confidence(raw_analysis)
    primary_equipment = _parse_single_value("PRIMARY_EQUIPMENT", raw_analysis) or parsed_equipment_type
    if network_detected_objects and (
        not primary_equipment
        or _router_profile_terms_detected(_normalize_vision_text(primary_equipment))
    ):
        primary_equipment = VISION_VISIBLE_WIFI_ROUTER_LABEL

    detected_brands = _parse_list_or_inline_block("BRANDS", raw_analysis)
    if not detected_brands:
        detected_brands = _parse_brands_from_json_response(raw_analysis)

    parsed_result = VisionAnalysisResult(
        image_type=parsed_image_type,
        analysis=analysis,
        detected_kpis=_parse_bullet_block("KPI", raw_analysis),
        recommendations=_parse_bullet_block("RECOMMANDATIONS", raw_analysis),
        confidence=parsed_confidence,
        model=settings.ollama_vision_model,
        detected_objects=detected_objects,
        detected_brands=detected_brands,
        detected_operators=_parse_list_or_inline_block("OPERATORS", raw_analysis),
        sim_types=_parse_list_or_inline_block("SIM_TYPES", raw_analysis),
        primary_equipment=primary_equipment,
        apparent_condition=_parse_single_value("APPARENT_CONDITION", raw_analysis),
        probable_usage=_parse_single_value("PROBABLE_USAGE", raw_analysis),
        replacement_signals=_parse_list_or_inline_block("REPLACEMENT_SIGNALS", raw_analysis),
        widgets=_parse_bullet_block("WIDGETS", raw_analysis),
        charts=_parse_bullet_block("CHARTS", raw_analysis),
        critical_zones=_parse_bullet_block("CRITICAL_ZONES", raw_analysis),
        radar_axes=_parse_radar_axes(raw_analysis),
        raw_output=raw_analysis,
    )
    VISION_LOGGER.info("PARSED_DETECTED_OBJECTS=%s", parsed_result.detected_objects)
    VISION_LOGGER.info("VISION_IMAGE_TYPE=%s", parsed_result.image_type)
    VISION_LOGGER.info("VISION_CONFIDENCE=%s", round(parsed_result.confidence, 4))
    VISION_LOGGER.info(
        "VISION_TOTAL_DURATION_MS=%s",
        round((time.perf_counter() - overall_started_at) * 1000),
    )
    VISION_LOGGER.info(
        "event=vision_analysis_completed model=%s prompt_profile=%s image_type=%s confidence=%s detected_objects=%s recommendations=%s",
        settings.ollama_vision_model,
        prompt_profile,
        parsed_result.image_type,
        round(parsed_result.confidence, 4),
        len(parsed_result.detected_objects),
        len(parsed_result.recommendations),
    )

    return parsed_result
