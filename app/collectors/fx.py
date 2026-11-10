"""
Cotacao para lojas que nao faturam em dolar.

O Opero inteiro soma dinheiro como numero puro: `profitCalc.ts` nao tem uma
linha sobre cambio, e o coletor guardava a moeda do pedido sem nunca usar. Isso
nunca mordeu porque todas as lojas eram USD — mas uma loja em iene entraria com
a receita inflada ~158x, porque Y1 viraria $1.

A conversao acontece na IMPORTACAO, no ponto em que o valor sai do objeto da
Shopify. Assim tudo que vem depois — agregados diarios, por pais, por cliente,
o motor de lucro, os relatorios — continua lendo numero em dolar sem saber que
existiu conversao. Nenhuma consulta precisou mudar.

Para loja em dolar isto e um no-op comprovado: `taxas_do_periodo` devolve {} e
`para_usd` devolve o valor intacto, sem tocar em rede nem em banco.

Fonte: Frankfurter (dados do Banco Central Europeu), gratis e sem chave. Ela so
publica dia util, entao fim de semana e feriado herdam a ultima cotacao
anterior — e por isso a taxa usada fica gravada em `shopify_orders.fx_rate`:
sem ela nao daria para reconstruir o valor original em iene.
"""

import logging
from datetime import date, timedelta
from typing import Dict, Optional

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

FONTE = "frankfurter"
URL = "https://api.frankfurter.app"
TIMEOUT = 25

# Quanto voltar para tras procurando uma cotacao anterior quando o periodo
# comeca num fim de semana ou feriado longo.
FOLGA_DIAS = 10


class FxError(RuntimeError):
    pass


def _buscar(moeda: str, de: date, ate: date) -> Dict[date, float]:
    """Pega a serie da Frankfurter. Devolve so os dias que ela publicou."""
    url = f"{URL}/{de.isoformat()}..{ate.isoformat()}?from={moeda}&to=USD"
    try:
        r = requests.get(url, timeout=TIMEOUT)
    except requests.RequestException as e:
        raise FxError(f"nao consegui falar com a fonte de cotacao: {e}") from e
    if r.status_code != 200:
        raise FxError(f"a fonte de cotacao respondeu HTTP {r.status_code}")
    corpo = r.json()
    fora: Dict[date, float] = {}
    for dia, valores in (corpo.get("rates") or {}).items():
        taxa = valores.get("USD")
        if taxa:
            fora[date.fromisoformat(dia)] = float(taxa)
    return fora


def _gravar(session: Session, moeda: str, taxas: Dict[date, float]) -> None:
    if not taxas:
        return
    session.execute(
        text(
            "INSERT INTO fx_rates (date, currency, usd_rate, source) "
            "VALUES (:d, :m, :t, :f) "
            "ON CONFLICT (date, currency) DO UPDATE SET "
            "usd_rate = EXCLUDED.usd_rate, source = EXCLUDED.source, fetched_at = now()"
        ),
        [{"d": d, "m": moeda, "t": t, "f": FONTE} for d, t in taxas.items()],
    )
    session.commit()


def _do_banco(session: Session, moeda: str, de: date, ate: date) -> Dict[date, float]:
    linhas = session.execute(
        text(
            "SELECT date, usd_rate FROM fx_rates "
            "WHERE currency = :m AND date BETWEEN :de AND :ate"
        ),
        {"m": moeda, "de": de, "ate": ate},
    ).fetchall()
    return {l[0]: float(l[1]) for l in linhas}


def taxas_do_periodo(
    session: Session, moeda: Optional[str], de: date, ate: date
) -> Dict[date, float]:
    """Cotacao de `moeda` para USD, um valor por dia do periodo.

    Para USD (ou moeda ausente) devolve {} — o chamador trata ausencia como 1.0,
    entao loja em dolar nao faz chamada nenhuma e nao muda de comportamento.

    Dia sem publicacao (fim de semana, feriado) herda a ultima cotacao anterior.
    """
    if not moeda or moeda.upper() == "USD":
        return {}
    moeda = moeda.upper()

    inicio = de - timedelta(days=FOLGA_DIAS)
    taxas = _do_banco(session, moeda, inicio, ate)

    # So vai na rede se faltar algum dia util do periodo pedido.
    faltando = [
        d for d in _dias(de, ate)
        if d not in taxas and d.weekday() < 5
    ]
    if faltando:
        try:
            novas = _buscar(moeda, inicio, ate)
            _gravar(session, moeda, novas)
            taxas.update(novas)
        except FxError as e:
            # Nao derruba o sync por causa de cotacao: se ja houver taxa no
            # banco usamos a que tem. Se nao houver nenhuma, quem chama decide.
            logger.warning("[fx] %s", e)

    if not taxas:
        raise FxError(
            f"nenhuma cotacao de {moeda} para {de}..{ate}. "
            "Sem ela eu nao converto, e importar em moeda local daria numero errado."
        )

    # Preenche os buracos herdando o ultimo dia publicado.
    completo: Dict[date, float] = {}
    ultima = None
    for d in _dias(inicio, ate):
        if d in taxas:
            ultima = taxas[d]
        if ultima is not None and d >= de:
            completo[d] = ultima

    # Se o periodo comeca antes da primeira cotacao conhecida, usa a primeira.
    if completo:
        primeira = min(taxas.items(), key=lambda kv: kv[0])[1]
        for d in _dias(de, ate):
            completo.setdefault(d, primeira)

    return completo


def _dias(de: date, ate: date):
    d = de
    while d <= ate:
        yield d
        d += timedelta(days=1)


def para_usd(valor: float, dia: Optional[date], taxas: Dict[date, float]) -> float:
    """Converte um valor para dolar. Sem taxas (loja USD) devolve intacto."""
    if not taxas:
        return valor
    if dia is None:
        # Valor sem data propria, como o gasto de vida inteira de um cliente:
        # usa a cotacao mais recente que temos. E aproximacao, e esta anotado.
        taxa = taxas[max(taxas)]
    else:
        taxa = taxas.get(dia) or taxas[max(taxas)]
    return valor * taxa


def taxa_do_dia(dia: Optional[date], taxas: Dict[date, float]) -> Optional[float]:
    """A taxa aplicada, para gravar junto do pedido e permitir auditoria."""
    if not taxas:
        return None
    if dia is None:
        return taxas[max(taxas)]
    return taxas.get(dia) or taxas[max(taxas)]
