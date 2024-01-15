import * as THREE from "three";
import { GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Chess, Move, Square } from "chess.js";
import "./style.css";

let loader = new GLTFLoader();
let scene = new THREE.Scene();
let raycaster = new THREE.Raycaster();
let pointer = new THREE.Vector2();
let bot: Worker;

let game = new Chess();
let isPlayerTurn = true;
let selectedPiece: string | undefined;
let validMoves: Move[] = [];
let previousMove: Move | undefined;

const loadScene = () => {
  loader.load(
    "./models/chess.glb",
    function (gltf: GLTF) {
      addGLTFSceneToScene(gltf);
      addLights();
      const camera = getCamera();
      const renderer = createAddAndGetRenderer();
      const controls = setAndGetOrbitControls(camera, renderer);

      function animate() {
        raycaster.setFromCamera(pointer, camera);
        controls.update();
        renderer.render(scene, camera);

        requestAnimationFrame(animate);
      }
      animate();

      addListeners();
      initBoardState();
      initStockfish();
    },
    undefined,
    function (error) {
      console.error(error);
    }
  );
};

const addGLTFSceneToScene = (gltf: GLTF) => {
  gltf.scene.rotation.x = Math.PI / 2;
  scene.add(gltf.scene);
};

const addLights = () => {
  const pointLightOne = new THREE.PointLight(0xffffff, 50, 100);
  pointLightOne.position.set(2, -2, 5);
  const pointLightTwo = new THREE.PointLight(0xffffff, 50, 100);
  pointLightTwo.position.set(-2, 2, 5);

  scene.add(pointLightOne);
  scene.add(pointLightTwo);
};

const setAndGetOrbitControls = (
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer
) => {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = true;
  controls.rotateSpeed = 1.0;

  controls.minPolarAngle = Math.PI / 2;
  controls.maxPolarAngle = Math.PI;

  controls.minAzimuthAngle = 0;
  controls.maxAzimuthAngle = 0;

  controls.update();

  return controls;
};

const getCamera = () => {
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, -1.5, 2.75);
  return camera;
};

const createAddAndGetRenderer = () => {
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  return renderer;
};

const addListeners = () => {
  addPointerMoveListener();
  addClickListener();
};

const addPointerMoveListener = () => {
  const onPointerMove = (event: PointerEvent) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  };
  window.addEventListener("pointermove", onPointerMove);
};

const addClickListener = () => {
  const onClick = () => {
    if (!isPlayerTurn) return;

    if (selectedPiece) {
      handleSecondPlayerInteraction();
      return;
    }

    handleFirstPlayerInteraction();
  };
  window.addEventListener("click", onClick);
};

const moveSelectedPiece = async (to: string) => {
  if (!selectedPiece) return;

  const from = getPiecePosition(selectedPiece);

  if (!from) return;
  let move, promotionPiece;
  try {
    if (shouldPromote(selectedPiece, to)) {
      promotionPiece = await getPromotionPiece();
    }

    move = game.move({
      from,
      to,
      promotion: getPromotionPieceMoveCharacter(promotionPiece),
    });

    if (isCastlingMove(move)) {
      castleRook(move, to);
    }

    if (isEnPassantMove(move)) {
      captureEnPassantPawn();
    }

    if (isPromotionMove(move)) {
      removePawnAndAddPromotedPiece(promotionPiece, to);
    }

    movePieceOnBoard(from, to);

    setAndIlluminatePreviousMove(move);
    isPlayerTurn = false;
    showVerdictIfNecessary();
  } catch {
    throw "Invalid move";
  } finally {
    unsetSelectedPieceAndValidMoves();
  }
};

const showVerdictIfNecessary = () => {
  if (!isGameOver()) return;
  showGameVerdict();
};

const removePawnAndAddPromotedPiece = (
  promotionPiece: string | undefined,
  to: string
) => {
  if (!promotionPiece || !selectedPiece) return;
  removePawn();
  addPromotedPiece(promotionPiece, to);
};

const addPromotedPiece = (promotionPiece: string, to: string) => {
  const promotionPieceObject = getPromotionPieceObject(promotionPiece);
  addPieceAt(promotionPieceObject, to);
};

const addPieceAt = (
  pieceObject: THREE.Object3D<THREE.Object3DEventMap> | undefined,
  to: string
) => {
  if (!pieceObject) return;

  boardState[pieceObject.name] = to;
  const positionObject = getSceneObject(to);
  const newPosition = positionObject?.position;
  if (!!newPosition) {
    pieceObject.visible = true;
    pieceObject.frustumCulled = true;
    pieceObject.position.copy(newPosition);
    pieceObject.position.y = pieceObject.position.y + 0.01475;
    scene.children[0].add(pieceObject);
  }
};

const removePawn = () => {
  if (!selectedPiece) return;
  delete boardState[selectedPiece];
  const selectedPieceObject = getSceneObject(selectedPiece);
  removePieceFromBoard(selectedPieceObject);
};

const isCastlingMove = (move: Move) =>
  isKingSideCastling(move) || isQueenSideCastling(move);

const castleRook = (move: Move, to: string) => {
  const pieceColour = isPlayerTurn ? "white" : "black";

  if (isKingSideCastling(move)) {
    const kingSideRookPosition = getPiecePosition(`rook_${pieceColour}_1`);
    const kingSideRookToPosition = getPreviousFileSameRankPosition(to);
    if (!kingSideRookPosition) return;
    movePieceOnBoard(kingSideRookPosition, kingSideRookToPosition);
  }

  if (isQueenSideCastling(move)) {
    const queenSideRookPosition = getPiecePosition(`rook_${pieceColour}_2`);
    const queenSideRookToPosition = getNextFileSameRankPosition(to);
    if (!queenSideRookPosition) return;
    movePieceOnBoard(queenSideRookPosition, queenSideRookToPosition);
  }
};

const captureEnPassantPawn = () => {
  if (!previousMove) return;
  const capturedPiece = getPieceAt(previousMove.to);
  const capturedPieceObject = getSceneObject(capturedPiece);
  if (capturedPiece) delete boardState[capturedPiece];
  removePieceFromBoard(capturedPieceObject);
};

const isGameOver = () => game.isCheckmate() || game.isDraw();

const showGameVerdict = () => {
  if (game.isCheckmate()) {
    showCheckmateVerdict();
  }
  if (game.isDraw()) {
    showDrawVerdict();
  }
};

const getPromotionPieceMoveCharacter = (promotionPiece: string = "queen") => {
  const promotionPieceToCharacterMap: Record<string, string> = {
    queen: "q",
    knight: "n",
    bishop: "b",
    rook: "r",
  };

  return promotionPieceToCharacterMap[promotionPiece] ?? "q";
};

const getPromotionPieceObject = (promotionPiece: string) => {
  const originalPieces = scene.children[0].children.filter(
    ({ name }: THREE.Object3D<THREE.Object3DEventMap>) =>
      name.includes(`${promotionPiece}_white`)
  );
  const latestBuiltPiece = originalPieces[originalPieces.length - 1];
  const newPiece = latestBuiltPiece.clone();
  newPiece.name = `${promotionPiece}_white_${originalPieces.length + 1}`;
  return newPiece;
};

let deferredResolve: ((piece: string) => void) | undefined;
(window as any).onPromote = (event: SubmitEvent) => {
  event.preventDefault();
  if (!event.target || !deferredResolve) return;
  const formData = new FormData(event.target as HTMLFormElement);
  const formValues = Object.fromEntries(formData);
  deferredResolve(formValues["promotion-piece"] as string);
};

(window as any).onSelectPromotionPiece = (piece: string) => {
  const promotionPieceInput = document.querySelector(
    `input[data-id="${piece}"]`
  );
  if (!promotionPieceInput) return;
  (promotionPieceInput as HTMLInputElement).checked = true;
};

(window as any).onStopPropagation = (event: MouseEvent) =>
  event.stopPropagation();

(window as any).restartGame = () => {
  game.reset();
  initBoardState();
  resetScene();
  closeVerdictModal();
};

const closeVerdictModal = () => {
  const verdictModalNode = document.getElementById("verdict-modal");
  if (!verdictModalNode) return;
  verdictModalNode.style.display = "none";
};

function resetScene() {
  loader = new GLTFLoader();
  scene = new THREE.Scene();
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  game = new Chess();
  isPlayerTurn = true;
  selectedPiece = undefined;
  validMoves = [];
  previousMove = undefined;

  loadScene();
}

const deferredPromise = () =>
  new Promise<string>(
    (resolve) =>
      (deferredResolve = (piece: string) => {
        resolve(piece);
        deferredResolve = undefined;
      })
  );

const getPromotionPiece = () => {
  const promotionModal = document.getElementById("promotion-modal");
  if (!promotionModal) return;
  promotionModal.style.display = "block";

  return deferredPromise().then((piece: string) => {
    const promotionModal = document.getElementById("promotion-modal");
    if (!promotionModal) return;
    promotionModal.style.display = "none";
    return piece;
  });
};

const isPromotionMove = (move: Move) => !!move.promotion;

const shouldPromote = (piece: string, to: string) => {
  const rank = to.split("")[1];
  const isPawn = piece.includes("pawn");
  return isPawn && (rank === "8" || rank === "1");
};

const setAndIlluminatePreviousMove = (move: Move | undefined) => {
  deilluminateOlderPreviousMove();
  previousMove = move;
  illuminatePreviousMove();
};

const getPreviousFileSameRankPosition = (position: string | undefined) => {
  if (!position) return "a1";
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const [positionFile, positionRank] = position.split("");
  const positionFileIndex = files.indexOf(positionFile);
  if (positionFileIndex === -1) return "a1";
  return `${files[positionFileIndex - 1]}${positionRank}`;
};

const getNextFileSameRankPosition = (position: string | undefined) => {
  if (!position) return "a1";
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const [positionFile, positionRank] = position.split("");
  const positionFileIndex = files.indexOf(positionFile);
  if (positionFileIndex === -1) return "a1";
  return `${files[positionFileIndex + 1]}${positionRank}`;
};

const initStockfish = () => {
  bot = new Worker("./node_modules/stockfish/src/stockfish-nnue-16-single.js");
  bot.postMessage("uci");
  bot.postMessage("ucinewgame");
  bot.postMessage("isready");

  bot.onmessage = onBotMessage;
};

const onBotMessage = (event: MessageEvent<string>) => {
  const message = event.data;
  if (!message.includes("bestmove")) return;

  const { from, to, promotion } = getBestMoveDetails(message);

  const move = game.move({ from, to, promotion });

  if (isCastlingMove(move)) {
    castleRook(move, to);
  }

  if (isEnPassantMove(move)) {
    captureEnPassantPawn();
  }

  if (!!promotion) {
    promotePiece(promotion, from, to);
  }

  movePieceOnBoard(from, to);
  setAndIlluminatePreviousMove(move);
  isPlayerTurn = true;

  showVerdictIfNecessary();
};

const getBestMoveDetails = (bestMoveMessage: string) => {
  const bestMove = bestMoveMessage.split(" ")[1];
  const from = bestMove.slice(0, 2);
  const to = bestMove.slice(2, 4);
  const promotion = bestMove.slice(4, 5);
  return { from, to, promotion };
};

const promotePiece = (promotionPiece: string, from: string, to: string) => {
  const promotionPieceObject = getPieceCharacterToPiece(promotionPiece);
  const piece = getPieceAt(from);
  const pieceObject = getSceneObject(piece);
  removePawnPieceAndAddPromotedPiece(promotionPieceObject, to, pieceObject);
};

const removePawnPieceAndAddPromotedPiece = (
  promotionPiece: THREE.Object3D<THREE.Object3DEventMap> | undefined,
  to: string,
  pawnPiece: THREE.Object3D<THREE.Object3DEventMap> | undefined
) => {
  if (!promotionPiece || !pawnPiece) return;
  removePawnPiece(pawnPiece);
  addPieceAt(promotionPiece, to);
};

const removePawnPiece = (pawnPiece: THREE.Object3D<THREE.Object3DEventMap>) => {
  delete boardState[pawnPiece.name];
  removePieceFromBoard(pawnPiece);
};

const showDrawVerdict = () => {
  const gameVerdictNode = document.getElementById("game-verdict");
  if (!gameVerdictNode) return;
  gameVerdictNode.textContent = "Draw!";

  const verdictModalNode = document.getElementById("verdict-modal");
  if (!verdictModalNode) return;
  verdictModalNode.style.display = "block";
};

const showCheckmateVerdict = () => {
  const didPlayerWin = !isPlayerTurn;
  const gameVerdictNode = document.getElementById("game-verdict");
  if (!gameVerdictNode) return;
  gameVerdictNode.textContent = `Checkmate! (${
    didPlayerWin ? "Player" : "Computer"
  } wins)`;

  const verdictModalNode = document.getElementById("verdict-modal");
  if (!verdictModalNode) return;
  verdictModalNode.style.display = "block";
};

const isEnPassantMove = (move: Move) => move.flags === "e";

const getPieceCharacterToPiece = (pieceCharacter: string) => {
  const pieceCharacterToPieceMap: Record<string, string> = {
    q: `queen_${isPlayerTurn ? "white" : "black"}`,
    n: `knight_${isPlayerTurn ? "white" : "black"}`,
    b: `bishop_${isPlayerTurn ? "white" : "black"}`,
    r: `rook_${isPlayerTurn ? "white" : "black"}`,
  };
  const piece =
    pieceCharacterToPieceMap[pieceCharacter] ??
    `queen_${isPlayerTurn ? "white" : "black"}`;
  const originalPieces = scene.children[0].children.filter(
    ({ name }: THREE.Object3D<THREE.Object3DEventMap>) => name.includes(piece)
  );
  const latestBuiltPiece = originalPieces[originalPieces.length - 1];
  const newPiece = latestBuiltPiece.clone();
  newPiece.name = `${piece}_${originalPieces.length + 1}`;
  return newPiece;
};

const initBoardState = () => {
  boardState = {
    pawn_white_1: "a2",
    pawn_white_2: "b2",
    pawn_white_3: "c2",
    pawn_white_4: "d2",
    pawn_white_5: "e2",
    pawn_white_6: "f2",
    pawn_white_7: "g2",
    pawn_white_8: "h2",
    pawn_black_1: "a7",
    pawn_black_2: "b7",
    pawn_black_3: "c7",
    pawn_black_4: "d7",
    pawn_black_5: "e7",
    pawn_black_6: "f7",
    pawn_black_7: "g7",
    pawn_black_8: "h7",
    rook_white_2: "a1",
    knight_white_2: "b1",
    bishop_white_2: "c1",
    queen_white_1: "d1",
    king_white: "e1",
    bishop_white_1: "f1",
    knight_white_1: "g1",
    rook_white_1: "h1",
    rook_black_2: "a8",
    knight_black_2: "b8",
    bishop_black_2: "c8",
    queen_black_1: "d8",
    king_black: "e8",
    bishop_black_1: "f8",
    knight_black_1: "g8",
    rook_black_1: "h8",
  };
};

const makeBotMove = () => {
  const fen = game.fen();
  bot.postMessage(`position fen ${fen}`);
  bot.postMessage("go depth 15");
};

const handleFirstPlayerInteraction = () => {
  const interactedObject = getInteractedObject();
  if (!interactedObject) return;

  setAndIlluminateSelectedPiece(interactedObject.object);
  setAndIlluminateValidMovesFor(selectedPiece);
};

const setAndIlluminateSelectedPiece = (
  object: THREE.Object3D<THREE.Object3DEventMap>
) => {
  selectedPiece = checkAndGetIfPiece(object);
  if (!selectedPiece) return;

  illuminatePiece(selectedPiece);
};

const setAndIlluminateValidMovesFor = (pieceName: string | undefined) => {
  if (!pieceName) return;

  const piecePosition = getPiecePosition(pieceName);
  validMoves = getValidMovesFor(piecePosition);
  illuminateValidMoves();
};

const getInteractedObject = () => {
  const intersects = raycaster
    .intersectObjects(scene.children[0].children)
    .filter((intersect) => intersect.object.visible);
  if (intersects.length === 0) return;

  const firstIntersect = intersects[0];

  return firstIntersect;
};

const unsetSelectedPieceAndValidMoves = () => {
  unsetSelectedPiece();
  unsetValidMoves();
};

const unsetSelectedPiece = () => {
  if (!selectedPiece) return;

  deilluminatePiece(selectedPiece);
  selectedPiece = undefined;
};

const unsetValidMoves = () => {
  deilluminateValidMoves();
  validMoves = [];
};

const handleSecondPlayerInteraction = () => {
  if (!selectedPiece) return;

  const interactedObject = getInteractedObject();
  if (!interactedObject) return;

  const piece = checkAndGetIfPiece(interactedObject.object);
  if (piece) {
    handleSecondPieceInteraction(piece);
  } else {
    moveSelectedPieceAndTriggerBotMove(interactedObject.object.name);
  }
};

const handleSecondPieceInteraction = (piece: string) => {
  const to = getPiecePosition(piece);
  const pieceObject = getSceneObject(piece);
  const move = checkAndGetValidMoveForSelectedPiece(to);
  if (!move && pieceObject) {
    unsetSelectedPieceAndValidMoves();
    setAndIlluminateSelectedPiece(pieceObject);
    setAndIlluminateValidMovesFor(selectedPiece);
  } else {
    if (!to || !move) return;
    moveSelectedPieceAndTriggerBotMove(to);
  }
};

const isKingSideCastling = ({ san }: Move) => san === "O-O";

const isQueenSideCastling = ({ san }: Move) => san === "O-O-O";

const moveSelectedPieceAndTriggerBotMove = async (to: string) => {
  try {
    await moveSelectedPiece(to);
    makeBotMove();
  } catch {}
};

const checkAndGetValidMoveForSelectedPiece = (to: string | undefined) =>
  validMoves.find(({ to: toPosition }: Move) => toPosition === to);

const checkAndGetIfPiece = ({
  name,
}: THREE.Object3D<THREE.Object3DEventMap>) => {
  const pieceNames = ["rook", "bishop", "knight", "queen", "king", "pawn"];
  const clickedPiece = pieceNames.find((pieceName: string) =>
    name.includes(pieceName)
  );

  if (clickedPiece) {
    return name;
  }

  const pieceOnPosition = Object.entries(boardState).find(
    ([_, position]) => position === name
  );

  if (pieceOnPosition) {
    return pieceOnPosition[0];
  }
};

const illuminatePiece = (pieceName: string | undefined) => {
  const selectedPieceObject = getSceneObject(pieceName);
  illuminateObject(selectedPieceObject, 0x00ff00);
};

const illuminateObject = (
  object: THREE.Object3D<THREE.Object3DEventMap> | undefined,
  color: string | number
) => {
  object?.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material.emissive !== undefined) {
      const clonedMaterial = child.material.clone();
      clonedMaterial.emissive.set(color);
      child.material = clonedMaterial;
      child.material.needsUpdate = true;
    }
  });
};

const deilluminatePiece = (pieceName: string) => {
  const selectedPieceObject = getSceneObject(pieceName);
  deilluminateObject(selectedPieceObject);
};

const deilluminateObject = (
  object: THREE.Object3D<THREE.Object3DEventMap> | undefined
) => {
  object?.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const clonedMaterial = child.material.clone();
      clonedMaterial.emissive.set(0x000000);
      child.material = clonedMaterial;
      child.material.needsUpdate = true;
    }
  });
};

const getValidMovesFor = (piecePosition: string | undefined) => {
  if (!piecePosition) return [];

  return game.moves({ square: piecePosition as Square, verbose: true });
};

const illuminateValidMoves = () => {
  if (!selectedPiece) return;

  validMoves
    .map(({ to }: Move) => to)
    .map((position: string) =>
      getSceneObject(position.length === 3 ? position.substring(1) : position)
    )
    .forEach(
      (positionObject: THREE.Object3D<THREE.Object3DEventMap> | undefined) =>
        illuminateObject(positionObject, 0x00ff00)
    );
};

const illuminatePreviousMove = () => {
  if (!previousMove) return;
  const { from, to } = previousMove;
  [from, to]
    .map((position: string) =>
      getSceneObject(position.length === 3 ? position.substring(1) : position)
    )
    .forEach(
      (positionObject: THREE.Object3D<THREE.Object3DEventMap> | undefined) =>
        illuminateObject(positionObject, 0xffff00)
    );
};

const deilluminateOlderPreviousMove = () => {
  if (!previousMove) return;
  const { from, to } = previousMove;
  [from, to]
    .map((position: string) =>
      getSceneObject(position.length === 3 ? position.substring(1) : position)
    )
    .forEach(
      (positionObject: THREE.Object3D<THREE.Object3DEventMap> | undefined) =>
        illuminateObject(positionObject, 0x000000)
    );
};

const deilluminateValidMoves = () => {
  validMoves
    .map(({ to }: Move) => to)
    .map((position: string) =>
      getSceneObject(position.length === 3 ? position.substring(1) : position)
    )
    .forEach(
      (positionObject: THREE.Object3D<THREE.Object3DEventMap> | undefined) =>
        illuminateObject(positionObject, 0x000000)
    );
};

const getPiecePosition = (pieceName: string) => {
  const pieceOnPosition = Object.entries(boardState).find(
    ([piece, _]) => piece === pieceName
  );

  if (pieceOnPosition) {
    return pieceOnPosition[1];
  }
};

const movePieceOnBoard = (from: string, to: string) => {
  const fromPiece = getPieceAt(from);
  const toPiece = getPieceAt(to);

  if (!fromPiece) return;
  const fromPieceObject = getSceneObject(fromPiece);

  if (toPiece) {
    const toPieceObject = getSceneObject(toPiece);
    removePieceFromBoard(toPieceObject);
    delete boardState[toPiece];
  }

  const positionObject = getPositionObject(to);
  if (!positionObject) return;
  boardState[fromPiece] = to;
  fromPieceObject?.position.set(
    positionObject.position.x,
    positionObject.position.y + 0.01475,
    positionObject.position.z
  );
};

const getPieceAt = (position: string) => {
  const positionAndPiece = Object.entries(boardState).find(
    ([_, boardPosition]) => boardPosition === position
  );

  if (!positionAndPiece) return;

  return positionAndPiece[0];
};

const getSceneObject = (objectName: string | undefined) =>
  scene.children[0].children.find(({ name }) => name === objectName);

const removePieceFromBoard = (
  pieceObject: THREE.Object3D<THREE.Object3DEventMap> | undefined
) => {
  if (!pieceObject) return;
  pieceObject.visible = false;
  pieceObject.frustumCulled = false;
};

const getPositionObject = (position: string) => {
  return getSceneObject(position);
};

let boardState: BoardState = {};

type BoardState = {
  [piece: string]: string;
};

loadScene();
