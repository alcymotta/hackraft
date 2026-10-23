// =====================================================================
// Hackraft - Céu: dia e noite, sol, lua, estrelas, nuvens, luzes e névoa
// ---------------------------------------------------------------------
// A hora é contada em segundos desde o nascer do sol:
//   0 ........ DIA_SEGUNDOS ........ CICLO_SEGUNDOS
//   (dia)                  (noite)
// =====================================================================
import * as THREE from 'three';
import { CONFIG, CICLO_SEGUNDOS } from './config.js';

const DISTANCIA_ASTRO = 400;   // distância do sol e da lua até a câmera
const RAIO_CUPULA = 500;
const RAIO_ESTRELAS = 450;
const TAMANHO_NUVEM_TEXEL = 12; // quantos blocos tem cada "pixel" de nuvem
const TEXTURA_NUVEM = 64;       // nuvem: textura de 64x64 pixels
const TAMANHO_PLANO_NUVEM = 800;
const VENTO_X = 1.2;            // velocidade do vento nas nuvens (blocos/s)
const VENTO_Z = 0.4;
const INCLINACAO_Z = 0.28;      // inclina um pouco a órbita dos astros

// ---------- funções pequenas de ajuda ----------
function suavizar(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Cria um canvas pequeno para desenhar texturas pixeladas
function criarCanvas(tamanho) {
  const c = document.createElement('canvas');
  c.width = c.height = tamanho;
  return c;
}

function texturaPixelada(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Textura do sol: núcleo branco, corpo amarelo-claro e um halo suave
function criarTexturaSol() {
  const c = criarCanvas(32);
  const g = c.getContext('2d');
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5)); // distância "quadrada"
      const dr = Math.hypot(x - 15.5, y - 15.5);
      if (d <= 2.5) g.fillStyle = 'rgba(255,255,255,1)';
      else if (d <= 6.5) g.fillStyle = 'rgba(255,248,190,1)';
      else if (dr <= 15.5) g.fillStyle = `rgba(255,230,140,${(0.28 * (1 - (dr - 6.5) / 9)).toFixed(3)})`;
      else continue;
      g.fillRect(x, y, 1, 1);
    }
  }
  return texturaPixelada(c);
}

// Textura da lua: quadrado cinza-claro com crateras
function criarTexturaLua() {
  const c = criarCanvas(32);
  const g = c.getContext('2d');
  g.fillStyle = '#d9dde6';
  g.fillRect(6, 6, 20, 20);
  g.fillStyle = '#c3c8d4';
  g.fillRect(6, 6, 20, 2);
  g.fillRect(6, 24, 20, 2);
  g.fillStyle = '#a9afbd';
  g.fillRect(10, 10, 4, 4);
  g.fillRect(18, 14, 5, 5);
  g.fillRect(11, 19, 3, 3);
  g.fillRect(20, 8, 2, 2);
  g.fillStyle = '#eef0f5';
  g.fillRect(8, 8, 2, 2);
  g.fillRect(22, 21, 2, 2);
  return texturaPixelada(c);
}

// Textura de nuvens: manchas em blocos (ruído de valores que se repete nas bordas)
function criarTexturaNuvens() {
  const N = TEXTURA_NUVEM;
  // grade grossa e grade fina de números aleatórios
  const criarGrade = (n) => Array.from({ length: n * n }, () => Math.random());
  const grossa = criarGrade(8);
  const fina = criarGrade(16);
  const amostra = (grade, n, x, y) => {
    // interpolação entre os pontos da grade, com volta nas bordas
    const fx = (x / N) * n, fy = (y / N) * n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const v = (i, j) => grade[((j % n) * n) + (i % n)];
    const a = v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx;
    const b = v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
  const c = criarCanvas(N);
  const g = c.getContext('2d');
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const valor = amostra(grossa, 8, x, y) * 0.65 + amostra(fina, 16, x, y) * 0.35;
      if (valor > 0.54) {
        g.fillStyle = '#ffffff';
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- Shaders ----------
const VERT_CUPULA = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG_CUPULA = `
  uniform vec3 uTopo;
  uniform vec3 uHorizonte;
  uniform vec3 uCorBrilho;
  uniform vec3 uDirSol;     // direção do sol (normalizada)
  uniform float uBrilho;    // 0 a 1: força do brilho do amanhecer/pôr do sol
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float alto = clamp(d.y, 0.0, 1.0);
    vec3 cor = mix(uHorizonte, uTopo, pow(alto, 0.55));
    // brilho alaranjado do lado do sol, perto do horizonte
    vec3 horizSol = normalize(vec3(uDirSol.x, 0.0, uDirSol.z) + 0.0001);
    vec3 horizD = normalize(vec3(d.x, 0.0, d.z) + 0.0001);
    float lado = pow(max(dot(horizD, horizSol), 0.0), 3.0);
    float perto = 1.0 - smoothstep(0.0, 0.55, alto);
    cor = mix(cor, uCorBrilho, clamp(lado * perto * uBrilho, 0.0, 1.0));
    gl_FragColor = vec4(cor, 1.0);
  }
`;
const VERT_NUVEM = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG_NUVEM = `
  uniform sampler2D uMapa;
  uniform vec2 uRepete;
  uniform vec2 uDeslocamento;
  uniform vec3 uCor;
  uniform float uOpacidade;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(uMapa, vUv * uRepete + uDeslocamento);
    float borda = 1.0 - smoothstep(0.55, 0.98, length(vUv - 0.5) * 2.0);
    float a = t.a * uOpacidade * borda;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uCor, a);
  }
`;

export class Ceu {
  constructor(scene) {
    this.scene = scene;
    this.hora = CONFIG.HORA_INICIAL;
    this.luzDoDia = 1;
    this.ehNoite = false;
    this.direcaoSol = new THREE.Vector3(1, 0, 0);
    this.direcaoLua = new THREE.Vector3(-1, 0, 0);
    this.corHorizonte = new THREE.Color();
    this.corTopo = new THREE.Color();

    // paletas (criadas uma vez só)
    this._diaTopo = new THREE.Color('#5a8fe0');
    this._diaHor = new THREE.Color('#a9cdf2');
    this._solTopo = new THREE.Color('#3d5f9a');
    this._solHor = new THREE.Color('#f0a060');
    this._noiteTopo = new THREE.Color('#04060f');
    this._noiteHor = new THREE.Color('#0c1428');
    this._corBrilho = new THREE.Color('#ff9a50');
    this._tmp = new THREE.Color();
    this._tmp2 = new THREE.Color();
    this._nuvemDia = new THREE.Color('#ffffff');
    this._nuvemNoite = new THREE.Color('#1c2236');
    this._nuvemSol = new THREE.Color('#ffd2b0');
    this._ambDia = new THREE.Color('#ffffff');
    this._ambNoite = new THREE.Color('#3a4a80');
    this._solLuzDia = new THREE.Color('#fff4e0');
    this._solLuzCrep = new THREE.Color('#ff9a55');
    this._vetor = new THREE.Vector3();

    // vento acumulado das nuvens
    this._ventoX = 0;
    this._ventoZ = 0;

    this._criarCupula();
    this._criarAstros();
    this._criarEstrelas();
    this._criarNuvens();
    this._criarLuzes();

    // névoa: some o terreno distante na cor do horizonte
    const alcance = CONFIG.DISTANCIA_RENDER * CONFIG.TAMANHO_CHUNK;
    scene.fog = new THREE.Fog(0xa9cdf2, alcance * CONFIG.NEVOA_INICIO, alcance * CONFIG.NEVOA_FIM);
    scene.background = new THREE.Color(0xa9cdf2);

    this._posCamera = new THREE.Vector3();
    this._calcular();
    this._posicionar(this._posCamera, 0);
  }

  // ---------- criação dos elementos ----------
  _criarCupula() {
    this._uCupula = {
      uTopo: { value: this.corTopo },
      uHorizonte: { value: this.corHorizonte },
      uCorBrilho: { value: this._corBrilho },
      uDirSol: { value: this.direcaoSol },
      uBrilho: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this._uCupula,
      vertexShader: VERT_CUPULA,
      fragmentShader: FRAG_CUPULA,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.cupula = new THREE.Mesh(new THREE.SphereGeometry(RAIO_CUPULA, 32, 16), mat);
    this.cupula.renderOrder = -1;
    this.cupula.frustumCulled = false;
    this.scene.add(this.cupula);
  }

  _criarAstros() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.sol = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: criarTexturaSol(), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    this.sol.scale.setScalar(90);
    this.lua = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: criarTexturaLua(), transparent: true, depthWrite: false, fog: false,
    }));
    this.lua.scale.setScalar(55);
    for (const m of [this.sol, this.lua]) {
      m.frustumCulled = false;
      m.renderOrder = 0;
      this.scene.add(m);
    }
  }

  _criarEstrelas() {
    const n = 800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // ponto aleatório numa esfera
      const u = Math.random() * 2 - 1;
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(ang) * r * RAIO_ESTRELAS;
      pos[i * 3 + 1] = u * RAIO_ESTRELAS;
      pos[i * 3 + 2] = Math.sin(ang) * r * RAIO_ESTRELAS;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 2, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.estrelas = new THREE.Points(geo, mat);
    this.estrelas.frustumCulled = false;
    this.estrelas.renderOrder = 0;
    this.estrelas.rotation.z = 0.4; // eixo inclinado
    this.scene.add(this.estrelas);
  }

  _criarNuvens() {
    const textura = criarTexturaNuvens();
    // o plano tem 800 blocos e cada tile da textura tem 64*12 blocos
    const blocosPorTile = TEXTURA_NUVEM * TAMANHO_NUVEM_TEXEL;
    this._blocosPorTile = blocosPorTile;
    this._uNuvem = {
      uMapa: { value: textura },
      uRepete: { value: new THREE.Vector2(TAMANHO_PLANO_NUVEM / blocosPorTile, TAMANHO_PLANO_NUVEM / blocosPorTile) },
      uDeslocamento: { value: new THREE.Vector2() },
      uCor: { value: new THREE.Color(1, 1, 1) },
      uOpacidade: { value: 0.85 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this._uNuvem,
      vertexShader: VERT_NUVEM,
      fragmentShader: FRAG_NUVEM,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.nuvens = new THREE.Mesh(new THREE.PlaneGeometry(TAMANHO_PLANO_NUVEM, TAMANHO_PLANO_NUVEM), mat);
    this.nuvens.rotation.x = -Math.PI / 2;
    this.nuvens.position.y = CONFIG.ALTURA_MUNDO + 24;
    this.nuvens.frustumCulled = false;
    this.nuvens.renderOrder = 1;
    this.scene.add(this.nuvens);
  }

  _criarLuzes() {
    this.luzAmbiente = new THREE.AmbientLight(0xffffff, 0.6);
    this.luzSol = new THREE.DirectionalLight(0xfff4e0, 1);
    this.luzLua = new THREE.DirectionalLight(0x8fa8ff, 0);
    this.scene.add(this.luzAmbiente, this.luzSol, this.luzLua, this.luzSol.target, this.luzLua.target);
  }

  // ---------- tempo ----------
  definirHora(segundos) {
    this.hora = ((segundos % CICLO_SEGUNDOS) + CICLO_SEGUNDOS) % CICLO_SEGUNDOS;
    this._calcular();
    this._posicionar(this._posCamera, 0);
  }

  atualizar(dt, posCamera) {
    this.hora = (this.hora + dt) % CICLO_SEGUNDOS;
    this._posCamera.copy(posCamera);
    this._calcular();
    this._posicionar(posCamera, dt);
  }

  // Calcula tudo que depende só da hora (cores, luz, direções)
  _calcular() {
    const h = this.hora;
    const T = Math.max(0.001, CONFIG.TRANSICAO_SEGUNDOS);
    const DIA = CONFIG.DIA_SEGUNDOS;
    const NOITE = CONFIG.NOITE_SEGUNDOS;
    this.ehNoite = h >= DIA;

    // Perto do fim do ciclo, a hora "vira" negativa para o nascer do sol (volta do ciclo)
    const volta = h > DIA + NOITE / 2;
    const hv = volta ? h - CICLO_SEGUNDOS : h;
    const subida = suavizar(-T / 2, T / 2, hv);
    const descida = volta ? 0 : suavizar(DIA - T / 2, DIA + T / 2, h);
    const fatorDia = subida * (1 - descida); // 0 = noite, 1 = dia
    this._fatorDia = fatorDia;
    this.luzDoDia = CONFIG.LUZ_MINIMA + (1 - CONFIG.LUZ_MINIMA) * fatorDia;

    // Quão perto estamos do nascer/pôr do sol (1 = bem no momento)
    const dist = Math.min(Math.abs(hv), Math.abs(h - DIA));
    const crep = 1 - suavizar(0, T, dist);
    this._crep = crep;

    // Cores do céu: noite -> dia, depois mistura com as cores do crepúsculo
    this.corTopo.copy(this._noiteTopo).lerp(this._diaTopo, fatorDia).lerp(this._solTopo, crep * 0.8);
    this.corHorizonte.copy(this._noiteHor).lerp(this._diaHor, fatorDia).lerp(this._solHor, crep);

    // Direções dos astros (ângulo por trechos)
    if (!this.ehNoite) {
      const a = Math.PI * (h / DIA);
      this.direcaoSol.set(Math.cos(a), Math.sin(a), INCLINACAO_Z).normalize();
      this.direcaoLua.copy(this.direcaoSol).negate();
    } else {
      const b = Math.PI * ((h - DIA) / NOITE);
      this.direcaoLua.set(Math.cos(b), Math.sin(b), -INCLINACAO_Z).normalize();
      this.direcaoSol.copy(this.direcaoLua).negate();
    }
  }

  // Põe tudo no lugar em volta da câmera
  _posicionar(cam, dt) {
    const fatorDia = this._fatorDia;
    const crep = this._crep;

    // cúpula, astros, estrelas e nuvens seguem a câmera
    this.cupula.position.copy(cam);
    this._uCupula.uBrilho.value = crep;

    this.sol.position.copy(cam).addScaledVector(this.direcaoSol, DISTANCIA_ASTRO);
    this.sol.lookAt(cam);
    this.sol.visible = this.direcaoSol.y > -0.15;
    this.lua.position.copy(cam).addScaledVector(this.direcaoLua, DISTANCIA_ASTRO);
    this.lua.lookAt(cam);
    this.lua.visible = this.direcaoLua.y > -0.15;

    // estrelas: aparecem só à noite e giram devagar
    this.estrelas.position.copy(cam);
    this.estrelas.rotation.y += dt * 0.01;
    this.estrelas.material.opacity = (1 - fatorDia) * (1 - fatorDia);
    this.estrelas.visible = this.estrelas.material.opacity > 0.01;

    // nuvens: o deslocamento compensa a câmera, então parecem presas ao mundo
    this._ventoX += VENTO_X * dt;
    this._ventoZ += VENTO_Z * dt;
    const tile = this._blocosPorTile;
    this.nuvens.position.x = cam.x;
    this.nuvens.position.z = cam.z;
    const desl = this._uNuvem.uDeslocamento.value;
    // u cresce com +x do mundo; v cresce com -z do mundo (plano girado)
    const ox = (cam.x - this._ventoX) / tile;
    const oy = -(cam.z - this._ventoZ) / tile;
    desl.set(ox - Math.floor(ox), oy - Math.floor(oy));
    // com a escala acima, o centro do plano cai em (offset + repete/2); o ajuste abaixo mantém a conta certa
    const rep = this._uNuvem.uRepete.value;
    desl.x -= rep.x * 0.5;
    desl.y -= rep.y * 0.5;
    this._uNuvem.uCor.value.copy(this._nuvemNoite).lerp(this._nuvemDia, fatorDia).lerp(this._nuvemSol, crep * 0.35);
    this._uNuvem.uOpacidade.value = 0.3 + 0.55 * fatorDia;

    // luzes
    this.luzAmbiente.color.copy(this._ambNoite).lerp(this._ambDia, fatorDia);
    this.luzAmbiente.intensity = 0.22 + 0.45 * fatorDia;

    this.luzSol.color.copy(this._solLuzDia).lerp(this._solLuzCrep, crep * 0.8);
    this.luzSol.intensity = 1.0 * fatorDia;
    this.luzSol.position.copy(cam).addScaledVector(this.direcaoSol, 100);
    this.luzSol.target.position.copy(cam);

    this.luzLua.intensity = 0.28 * (1 - fatorDia);
    this.luzLua.position.copy(cam).addScaledVector(this.direcaoLua, 100);
    this.luzLua.target.position.copy(cam);

    // névoa e fundo na cor do horizonte
    this.scene.fog.color.copy(this.corHorizonte);
    this.scene.background.copy(this.corHorizonte);
  }
}
