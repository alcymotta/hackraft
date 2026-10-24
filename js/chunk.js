// =====================================================================
// Hackraft - Chunk (um pedaço do mundo) e montagem da malha
// ---------------------------------------------------------------------
// O mundo é dividido em colunas de 16 x 16 blocos de largura e
// ALTURA_MUNDO de altura, chamadas "chunks". Cada chunk guarda os seus
// blocos num Uint8Array (1 byte por bloco = o id do bloco).
//
// A "malha" é o desenho 3D do chunk: uma lista de quadradinhos (faces)
// que a placa de vídeo desenha. Para ficar rápido, só criamos as faces
// que podem ser vistas (as que encostam no ar, na água, nas folhas...).
//
// Este arquivo NÃO usa o three.js: só números e typed arrays. Assim dá
// para testar no Node. Quem transforma os arrays em BufferGeometry é o
// world.js.
//
// Cada vértice leva: posição, uv, camada da textura, sombra (face × AO),
// luz do céu e, desde a Fase 5, o "brilho" (0 = normal; 1..255 = bloco
// com BLOCOS[id].brilho, e o valor é a fase da pulsação; ver o shader no
// world.js).
//
// Exporta:
//   TAM, ALTURA, AREA, VOLUME     tamanhos do chunk
//   indiceLocal(x, y, z)          posição no array de dados
//   Chunk                         dados de um chunk
//   MontadorMalha                 monta os arrays da malha de um chunk
// =====================================================================

import { CONFIG } from './config.js';
import { B, BLOCOS, OPACO, LIQUIDO, texturaDaFace } from './blocks.js';

export const TAM = CONFIG.TAMANHO_CHUNK;   // largura (x) e profundidade (z): 16
export const ALTURA = CONFIG.ALTURA_MUNDO; // altura (y)
export const AREA = TAM * TAM;             // blocos numa camada horizontal (256)
export const VOLUME = AREA * ALTURA;       // blocos no chunk inteiro

/**
 * Fórmula do índice no array de dados:
 *     indice = x + z * TAM + y * TAM * TAM
 * (x anda de 1 em 1, z de 16 em 16, y de 256 em 256).
 * x e z são LOCAIS (0..15) e y vai de 0 a ALTURA-1.
 * Assim cada camada horizontal (mesmo y) fica inteira em sequência na memória.
 */
export function indiceLocal(x, y, z) {
  return x + z * TAM + y * AREA;
}

// Tabela "tem partes furadas" (folhas). Folha encostada em folha desenha a face.
const RECORTE = new Uint8Array(256);
for (const b of BLOCOS) if (b && b.recorte) RECORTE[b.id] = 1;

// Tabela "brilha pulsando" (minérios de cristal, Fase 5). Vem do campo
// `brilho` de cada bloco em blocks.js.
const BRILHA = new Uint8Array(256);
for (const b of BLOCOS) if (b && b.brilho) BRILHA[b.id] = 1;

/**
 * Valor do atributo aBrilho de um bloco que brilha: de 1 a 255, sorteado
 * pela POSIÇÃO do bloco (sempre o mesmo para o mesmo lugar).
 * O shader usa esse número como "fase" da pulsação: cada bloco pulsa num
 * momento diferente, e os cristais não piscam todos juntos.
 * (0 fica reservado para "não brilha".)
 */
function faseDoBrilho(wx, y, wz) {
  let h = Math.imul(wx | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(wz | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return 1 + ((h >>> 0) % 255);
}

// =====================================================================
// Dados de um chunk
// =====================================================================
export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;               // coordenada do chunk (bloco x = cx * 16 + x local)
    this.cz = cz;
    this.chave = cx + ',' + cz;
    this.dados = new Uint8Array(VOLUME);

    // Mapa de altura: para cada coluna (x + z*16), o y do bloco OPACO mais
    // alto MAIS 1 (0 = coluna sem nenhum bloco opaco). Serve para a luz do céu:
    // tudo que está acima disso recebe sol; abaixo, fica escuro (cavernas).
    this.alturas = new Uint8Array(AREA);

    // y do bloco (não-ar) mais alto do chunk + 1. A montagem não precisa
    // olhar as camadas acima disso (só tem ar).
    this.yMaximo = 0;

    // Campos usados pelo world.js (ficam aqui para todos saberem que existem)
    this.malhaSolida = null;   // THREE.Mesh dos blocos sólidos
    this.malhaAgua = null;     // THREE.Mesh da água
    this.temMalha = false;     // true depois da 1ª montagem
    this.faces = 0;            // quantas faces a malha tem (para o debug)
  }

  /** Reaproveita este objeto para outro lugar do mundo (zera tudo). */
  reiniciar(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.chave = cx + ',' + cz;
    this.dados.fill(0);
    this.alturas.fill(0);
    this.yMaximo = 0;
    this.malhaSolida = null;
    this.malhaAgua = null;
    this.temMalha = false;
    this.faces = 0;
  }

  /** Bloco em coordenadas LOCAIS (x, z de 0 a 15). Fora da altura devolve ar. */
  obter(x, y, z) {
    if (y < 0 || y >= ALTURA) return B.AR;
    return this.dados[x + z * TAM + y * AREA];
  }

  /** Muda um bloco (coordenadas locais) e mantém o mapa de altura correto. */
  definir(x, y, z, id) {
    if (y < 0 || y >= ALTURA) return;
    this.dados[x + z * TAM + y * AREA] = id;
    this.atualizarColuna(x, z, y, id);
    if (id !== B.AR && y + 1 > this.yMaximo) this.yMaximo = y + 1;
  }

  /** Ajusta o mapa de altura da coluna (x, z) depois de mudar o bloco em y. */
  atualizarColuna(x, z, y, id) {
    const col = x + z * TAM;
    const alt = this.alturas[col];
    if (OPACO[id]) {
      if (y + 1 > alt) this.alturas[col] = y + 1;
    } else if (y + 1 === alt) {
      // Tiramos o bloco opaco do topo: procura o próximo opaco para baixo
      let yy = y - 1;
      while (yy >= 0 && !OPACO[this.dados[col + yy * AREA]]) yy--;
      this.alturas[col] = yy + 1;
    }
  }

  /** Recalcula o mapa de altura e o yMaximo do zero (usado depois de gerar). */
  calcularAlturas() {
    const d = this.dados;
    for (let col = 0; col < AREA; col++) {
      let y = ALTURA - 1;
      while (y >= 0 && !OPACO[d[col + y * AREA]]) y--;
      this.alturas[col] = y + 1;
    }
    // Procura de cima para baixo a primeira camada que tem algum bloco
    let yMax = 0;
    for (let y = ALTURA - 1; y >= 0 && yMax === 0; y--) {
      const base = y * AREA;
      for (let i = 0; i < AREA; i++) {
        if (d[base + i] !== B.AR) { yMax = y + 1; break; }
      }
    }
    this.yMaximo = yMax;
  }
}

// =====================================================================
// Montagem da malha
// =====================================================================

// Para não precisar perguntar "esse vizinho está em outro chunk?" a cada
// bloco, copiamos o chunk para uma caixa com 1 bloco de borda em volta
// (18 x 18 de largura e ALTURA+2 de altura). A borda vem dos 8 chunks
// vizinhos. Depois disso, o vizinho de qualquer bloco é só "índice + passo".
const PX = TAM + 2;          // largura da caixa com borda
const PAREA = PX * PX;       // uma camada da caixa
const PY = ALTURA + 2;       // altura da caixa (1 camada embaixo e 1 em cima)
const PVOLUME = PAREA * PY;
// índice na caixa: (x + 1) + (z + 1) * PX + (y + 1) * PAREA

// As 6 faces: 0 = +X (leste), 1 = -X (oeste), 2 = +Y (topo), 3 = -Y (baixo),
//             4 = +Z (sul),   5 = -Z (norte)
const PASSO_FACE = new Int32Array([1, -1, PAREA, -PAREA, PX, -PX]);

// Qual textura cada face usa: 0 = 'topo', 1 = 'lado', 2 = 'baixo'
const TEX_FACE = new Uint8Array([1, 1, 0, 2, 1, 1]);
const NOMES_TEX_FACE = ['topo', 'lado', 'baixo'];

// Sombra fixa de cada face (dá a sensação de volume, como no Minecraft)
const SOMBRA_FACE = new Float32Array([0.8, 0.8, 1.0, 0.5, 0.65, 0.65]);

// Quanto cada nível de oclusão de ambiente (AO) escurece.
// ao = 3: canto livre; ao = 0: canto bem apertado entre dois blocos.
const FATOR_AO = new Float32Array([0.45, 0.65, 0.82, 1.0]);

// Luz do céu em níveis de 0 a 15 (como no Minecraft). 15 = sol direto.
// Abaixo do bloco opaco mais alto da coluna (cavernas, buracos cobertos)
// a luz cai para LUZ_CAVERNA. Na Fase 6 entra um 2º canal (luz das tochas),
// calculado do mesmo jeito numa caixa "luzBloco" ao lado de "luzCeu".
const NIVEL_MAX = 15;
const NIVEL_CAVERNA = Math.round((CONFIG.LUZ_CAVERNA ?? 0.3) * NIVEL_MAX);

// A superfície da água fica um pouco abaixo do topo do bloco
const ALTURA_AGUA = 1 - (CONFIG.AFUNDAR_AGUA ?? 0.1);
const V_AGUA = Math.round(ALTURA_AGUA * 255); // coordenada v (textura) do topo da água nas laterais

// Os 4 cantos de cada face, na ordem anti-horária vista de FORA do bloco
// (é a ordem que o three.js considera "frente"). O canto k tem a coordenada
// de textura UV_CANTO[k]: (0,0) (1,0) (1,1) (0,1). Para as laterais, v = 0 é
// a base do bloco e v = 1 é o topo (a borda verde da grama fica em cima), e u
// cresce para a direita de quem olha de fora (a textura não fica espelhada).
const CANTOS = new Uint8Array([
  // +X: olhando de +X, a direita é -Z
  1, 0, 1,  1, 0, 0,  1, 1, 0,  1, 1, 1,
  // -X: olhando de -X, a direita é +Z
  0, 0, 0,  0, 0, 1,  0, 1, 1,  0, 1, 0,
  // +Y (topo): visto de cima, u = x e v cresce para -Z
  0, 1, 1,  1, 1, 1,  1, 1, 0,  0, 1, 0,
  // -Y (baixo): visto de baixo, u = x e v = z
  0, 0, 0,  1, 0, 0,  1, 0, 1,  0, 0, 1,
  // +Z: olhando de +Z, a direita é +X
  0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  // -Z: olhando de -Z, a direita é -X
  1, 0, 0,  0, 0, 0,  0, 1, 0,  1, 1, 0,
]);
const UV_CANTO = new Uint8Array([0, 0, 255, 0, 255, 255, 0, 255]);

// Para o AO e a luz suave, cada canto de face olha 3 células da camada que
// fica na frente da face: lado1, lado2 e a diagonal (canto).
// Calculamos aqui, uma vez só, o "passo" de índice até cada uma delas.
const VIZ_AO = new Int32Array(6 * 4 * 3);
(function calcularVizinhosAO() {
  const passoEixo = [1, PAREA, PX]; // passo para andar +1 em x, y, z na caixa
  const eixoNormal = [0, 0, 1, 1, 2, 2]; // eixo da normal de cada face
  for (let f = 0; f < 6; f++) {
    const n = eixoNormal[f];
    const t1 = (n + 1) % 3; // os 2 eixos "deitados" na face
    const t2 = (n + 2) % 3;
    for (let k = 0; k < 4; k++) {
      const c = (f * 4 + k) * 3;
      // canto com coordenada 0 → vizinho do lado de menos; 1 → lado de mais
      const s1 = CANTOS[c + t1] ? 1 : -1;
      const s2 = CANTOS[c + t2] ? 1 : -1;
      const lado1 = s1 * passoEixo[t1];
      const lado2 = s2 * passoEixo[t2];
      VIZ_AO[c] = lado1;
      VIZ_AO[c + 1] = lado2;
      VIZ_AO[c + 2] = lado1 + lado2;
    }
  }
})();

/**
 * Arrays de uma malha que vão crescendo conforme a necessidade.
 * São reaproveitados de um chunk para o outro (sem criar lixo para o
 * coletor de memória). No fim, extrair() copia só a parte usada.
 */
class BufferMalha {
  /**
   * @param capacidade quantos vértices cabem no começo (cresce sozinho)
   * @param comBrilho  true = guarda também o atributo aBrilho (a água não usa)
   */
  constructor(capacidade = 8192, comBrilho = true) {
    this.capacidade = 0;
    this.nVert = 0;
    this.nInd = 0;
    this.yMin = 0;
    this.yMax = 0;
    this.comBrilho = comBrilho;
    this.brilho = null;
    this.crescer(capacidade);
  }

  crescer(capacidade) {
    const ant = this.capacidade > 0 ? this : null;
    const pos = new Float32Array(capacidade * 3);
    const uv = new Uint8Array(capacidade * 2);
    const camada = new Uint8Array(capacidade);
    const sombra = new Uint8Array(capacidade);
    const luzCeu = new Uint8Array(capacidade);
    const brilho = this.comBrilho ? new Uint8Array(capacidade) : null;
    const ind = new Uint32Array((capacidade / 4) * 6);
    if (ant) {
      pos.set(ant.pos.subarray(0, ant.nVert * 3));
      uv.set(ant.uv.subarray(0, ant.nVert * 2));
      camada.set(ant.camada.subarray(0, ant.nVert));
      sombra.set(ant.sombra.subarray(0, ant.nVert));
      luzCeu.set(ant.luzCeu.subarray(0, ant.nVert));
      if (brilho) brilho.set(ant.brilho.subarray(0, ant.nVert));
      ind.set(ant.ind.subarray(0, ant.nInd));
    }
    this.pos = pos;
    this.uv = uv;
    this.camada = camada;
    this.sombra = sombra;
    this.luzCeu = luzCeu;
    this.brilho = brilho;
    this.ind = ind;
    this.capacidade = capacidade;
  }

  limpar() {
    this.nVert = 0;
    this.nInd = 0;
    this.yMin = ALTURA;
    this.yMax = 0;
  }

  /** Cópia exata da parte usada (o three.js guarda estes arrays). null se vazio. */
  extrair() {
    if (this.nVert === 0) return null;
    return {
      posicoes: this.pos.slice(0, this.nVert * 3), // Float32Array, 3 por vértice (coordenadas locais do chunk)
      uvs: this.uv.slice(0, this.nVert * 2),       // Uint8Array normalizado (0..255 = 0..1)
      camadas: this.camada.slice(0, this.nVert),   // Uint8Array normalizado: camada = valor * 255
      sombras: this.sombra.slice(0, this.nVert),   // Uint8Array normalizado (face × AO)
      luzCeu: this.luzCeu.slice(0, this.nVert),    // Uint8Array normalizado (luz do céu 0..1)
      // Uint8Array normalizado: 0 = não brilha; 1..255 = brilha, e o valor é a fase
      // da pulsação (null na água, que nunca brilha)
      brilhos: this.brilho ? this.brilho.slice(0, this.nVert) : null,
      indices: this.ind.slice(0, this.nInd),       // Uint32Array
      yMin: this.yMin,
      yMax: this.yMax,
    };
  }
}

/**
 * Monta as malhas de um chunk.
 *   const montador = new MontadorMalha(texturas.indice);
 *   const r = montador.montar(vizinhos);
 * `vizinhos` é um array de 9 chunks (ou null) em volta, nesta ordem:
 *   índice = (dz + 1) * 3 + (dx + 1)     (o do meio, índice 4, é o próprio chunk)
 * Devolve { solido, agua, faces }, onde solido/agua são os arrays prontos
 * para BufferGeometry (ver BufferMalha.extrair) ou null se não tiver nada.
 * Precisa dos vizinhos porque as faces da borda e o AO dos cantos olham
 * blocos que moram no chunk do lado.
 */
export class MontadorMalha {
  constructor(indiceTextura) {
    // indiceTextura(nome) → camada da textura (texturas.indice)
    this.indiceTextura = indiceTextura;
    // Cache id + face → camada da textura (-1 = ainda não perguntado)
    this.cacheCamadas = new Int16Array(256 * 3).fill(-1);

    this.blocos = new Uint8Array(PVOLUME); // caixa com borda: ids
    this.luzCeu = new Uint8Array(PVOLUME); // caixa com borda: luz do céu (0..15)

    // Camada de baixo da caixa (y = -1): finge que é rocha, para não desenhar
    // a face de baixo do mundo. Camada de cima (y = ALTURA): ar com sol.
    // Essas duas camadas nunca são sobrescritas.
    this.blocos.fill(B.ROCHA_MATRIZ, 0, PAREA);
    this.blocos.fill(B.AR, (PY - 1) * PAREA, PVOLUME);
    this.luzCeu.fill(NIVEL_MAX, (PY - 1) * PAREA, PVOLUME);

    this.solido = new BufferMalha(16384, true);
    this.agua = new BufferMalha(4096, false); // a água nunca brilha

    // Rascunhos para os 4 cantos de uma face (sem alocar no laço)
    this._sombra = new Float32Array(4);
    this._luz = new Float32Array(4);

    // Canto do chunk que está sendo montado, em coordenadas do mundo
    // (para sortear a fase do brilho pela posição de verdade do bloco)
    this._x0 = 0;
    this._z0 = 0;
  }

  /** Camada da textura de uma face do bloco (com cache). */
  camadaDe(id, texFace) {
    const k = id * 3 + texFace;
    let c = this.cacheCamadas[k];
    if (c < 0) {
      const nome = texturaDaFace(id, NOMES_TEX_FACE[texFace]);
      c = nome ? this.indiceTextura(nome) : 0;
      if (!(c >= 0 && c <= 255)) c = 0;
      this.cacheCamadas[k] = c;
    }
    return c;
  }

  /** Esquece o cache (use se as texturas forem recriadas). */
  limparCache() {
    this.cacheCamadas.fill(-1);
  }

  /** Copia o chunk do meio + 1 bloco de borda dos vizinhos para a caixa. */
  copiarComBorda(vizinhos) {
    const blocos = this.blocos;
    const luz = this.luzCeu;
    const centro = vizinhos[4];
    // Só precisamos até a camada logo acima do bloco mais alto do chunk do meio
    const yCopia = Math.min(centro.yMaximo + 1, ALTURA);

    for (let pz = 0; pz < PX; pz++) {
      const z = pz - 1;
      const dz = z < 0 ? -1 : (z >= TAM ? 1 : 0);
      const lz = z - dz * TAM;
      for (let px = 0; px < PX; px++) {
        const x = px - 1;
        const dx = x < 0 ? -1 : (x >= TAM ? 1 : 0);
        const lx = x - dx * TAM;
        const ch = vizinhos[(dz + 1) * 3 + (dx + 1)];
        let iDest = px + pz * PX + PAREA; // começa em y = 0
        if (ch) {
          const dados = ch.dados;
          const col = lx + lz * TAM;
          const alt = ch.alturas[col];
          let iSrc = col;
          for (let y = 0; y < yCopia; y++, iSrc += AREA, iDest += PAREA) {
            blocos[iDest] = dados[iSrc];
            // Luz do céu simples: acima do bloco opaco mais alto da coluna = sol
            luz[iDest] = y >= alt ? NIVEL_MAX : NIVEL_CAVERNA;
          }
        } else {
          // Vizinho não carregado: trata como ar iluminado
          for (let y = 0; y < yCopia; y++, iDest += PAREA) {
            blocos[iDest] = B.AR;
            luz[iDest] = NIVEL_MAX;
          }
        }
      }
    }
  }

  montar(vizinhos) {
    const centro = vizinhos[4];
    const solido = this.solido;
    const agua = this.agua;
    solido.limpar();
    agua.limpar();
    if (centro.yMaximo === 0) return { solido: null, agua: null, faces: 0 };

    this._x0 = centro.cx * TAM;
    this._z0 = centro.cz * TAM;
    this.copiarComBorda(vizinhos);
    const blocos = this.blocos;
    const yMax = centro.yMaximo;
    let faces = 0;

    for (let y = 0; y < yMax; y++) {
      for (let z = 0; z < TAM; z++) {
        let i = 1 + (z + 1) * PX + (y + 1) * PAREA; // índice na caixa do bloco (0, y, z)
        for (let x = 0; x < TAM; x++, i++) {
          const id = blocos[i];
          if (id === B.AR) continue;
          const recorte = RECORTE[id];
          for (let f = 0; f < 6; f++) {
            const n = blocos[i + PASSO_FACE[f]];
            // Regra da face visível:
            //  - vizinho é ar → desenha
            //  - vizinho opaco → não desenha (ninguém vê)
            //  - vizinho transparente (água, folhas) → desenha se for diferente
            //    de mim (pedra na água desenha; água com água não), e folha com
            //    folha desenha (fica com o visual "cheio" das copas)
            if (n !== B.AR && (OPACO[n] || (n === id && !recorte))) continue;
            if (LIQUIDO[id]) this.faceAgua(agua, i, x, y, z, f, id);
            else this.faceSolida(solido, i, x, y, z, f, id);
            faces++;
          }
        }
      }
    }
    return { solido: solido.extrair(), agua: agua.extrair(), faces };
  }

  /** Face de bloco sólido: com AO e luz suave por canto. */
  faceSolida(buf, i, x, y, z, f, id) {
    const blocos = this.blocos;
    const luz = this.luzCeu;
    const iN = i + PASSO_FACE[f]; // a célula para onde a face olha
    const sombraFace = SOMBRA_FACE[f];
    const tmpS = this._sombra;
    const tmpL = this._luz;

    // Para cada canto: AO (quantos dos 3 vizinhos são opacos) e a média
    // da luz das células transparentes em volta do canto (luz suave).
    for (let k = 0; k < 4; k++) {
      const o = (f * 4 + k) * 3;
      const i1 = iN + VIZ_AO[o];
      const i2 = iN + VIZ_AO[o + 1];
      const ic = iN + VIZ_AO[o + 2];
      const s1 = OPACO[blocos[i1]];
      const s2 = OPACO[blocos[i2]];
      const sc = OPACO[blocos[ic]];
      // Se os dois lados estão tampados, o canto fica no escuro máximo
      // (mesmo que a diagonal esteja livre, a luz não "passa" pela quina)
      const ambos = s1 & s2;
      const ao = ambos ? 0 : 3 - s1 - s2 - sc;

      let soma = luz[iN];
      let qtd = 1;
      if (!s1) { soma += luz[i1]; qtd++; }
      if (!s2) { soma += luz[i2]; qtd++; }
      if (!sc && !ambos) { soma += luz[ic]; qtd++; }

      tmpS[k] = sombraFace * FATOR_AO[ao];
      tmpL[k] = soma / qtd; // nível 0..15
    }

    // Truque contra o serrilhado: um quadrado vira 2 triângulos, e a cor é
    // interpolada em cada triângulo separado. Se um canto é escuro e os
    // outros claros, a escolha da diagonal muda o desenho. Cortamos pela
    // diagonal mais CLARA, assim a sombra de um canto fica presa no seu triângulo.
    const b0 = tmpS[0] * tmpL[0];
    const b1 = tmpS[1] * tmpL[1];
    const b2 = tmpS[2] * tmpL[2];
    const b3 = tmpS[3] * tmpL[3];
    const virar = b0 + b2 < b1 + b3;

    // Bloco que brilha (cristal): a fase depende da posição no mundo, então
    // as 6 faces do mesmo bloco pulsam juntas, e os vizinhos pulsam em outro momento
    const brilho = BRILHA[id] ? faseDoBrilho(this._x0 + x, y, this._z0 + z) : 0;

    this.escreverQuad(buf, x, y, z, f, this.camadaDe(id, TEX_FACE[f]), 1, virar, brilho);
  }

  /** Face de água: sem AO, superfície um pouco abaixada. */
  faceAgua(buf, i, x, y, z, f, id) {
    const acima = this.blocos[i + PAREA];
    // Abaixa o topo se em cima não tem água (nem bloco opaco tampando)
    const topo = (LIQUIDO[acima] || OPACO[acima]) ? 1 : ALTURA_AGUA;
    const l = this.luzCeu[i + PASSO_FACE[f]];
    const s = SOMBRA_FACE[f];
    const tmpS = this._sombra;
    const tmpL = this._luz;
    for (let k = 0; k < 4; k++) { tmpS[k] = s; tmpL[k] = l; }
    this.escreverQuad(buf, x, y, z, f, this.camadaDe(id, TEX_FACE[f]), topo, false, 0);
  }

  /**
   * Escreve os 4 vértices e os 6 índices de uma face.
   * brilho: 0 = normal; 1..255 = bloco que brilha (o valor é a fase da pulsação)
   */
  escreverQuad(buf, x, y, z, f, camada, topo, virar, brilho) {
    if (buf.nVert + 4 > buf.capacidade) buf.crescer(buf.capacidade * 2);
    const v = buf.nVert;
    const pos = buf.pos;
    const uv = buf.uv;
    const tmpS = this._sombra;
    const tmpL = this._luz;
    const rebaixado = topo !== 1;
    const arrBrilho = buf.brilho; // null na água
    if (arrBrilho) {
      arrBrilho[v] = brilho;
      arrBrilho[v + 1] = brilho;
      arrBrilho[v + 2] = brilho;
      arrBrilho[v + 3] = brilho;
    }

    for (let k = 0; k < 4; k++) {
      const c = (f * 4 + k) * 3;
      const cy = CANTOS[c + 1];
      const vi = v + k;
      pos[vi * 3] = x + CANTOS[c];
      pos[vi * 3 + 1] = y + (cy ? topo : 0);
      pos[vi * 3 + 2] = z + CANTOS[c + 2];
      uv[vi * 2] = UV_CANTO[k * 2];
      // Nas laterais da água rebaixada, a textura também é cortada no topo
      uv[vi * 2 + 1] = (rebaixado && cy && f !== 2 && f !== 3) ? V_AGUA : UV_CANTO[k * 2 + 1];
      buf.camada[vi] = camada;
      buf.sombra[vi] = (tmpS[k] * 255 + 0.5) | 0;
      buf.luzCeu[vi] = (tmpL[k] * (255 / NIVEL_MAX) + 0.5) | 0;
    }

    const ind = buf.ind;
    let n = buf.nInd;
    if (virar) {
      // diagonal 1-3
      ind[n++] = v + 1; ind[n++] = v + 2; ind[n++] = v + 3;
      ind[n++] = v + 1; ind[n++] = v + 3; ind[n++] = v;
    } else {
      // diagonal 0-2
      ind[n++] = v; ind[n++] = v + 1; ind[n++] = v + 2;
      ind[n++] = v; ind[n++] = v + 2; ind[n++] = v + 3;
    }
    buf.nInd = n;
    buf.nVert = v + 4;
    if (y < buf.yMin) buf.yMin = y;
    if (y + 1 > buf.yMax) buf.yMax = y + 1;
  }
}
