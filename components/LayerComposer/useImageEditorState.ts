/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
// FIX: Add missing React import
import React, { useState, useRef, useEffect, useCallback, useMemo, ChangeEvent } from 'react';
import { useMotionValue, useMotionValueEvent } from 'framer-motion';
import { handleFileUpload, type ImageToEdit } from '../uiUtils';
import { removeImageBackground, editImageWithPrompt } from '../../services/geminiService';
import { 
    type Tool, type EditorStateSnapshot, type Point, type Rect, type CropResizeHandle, type CropAction,
    type Interaction, type SelectionStroke, type PenNode, type ColorChannel,
    type ColorAdjustments,
} from './ImageEditor.types';
import { INITIAL_COLOR_ADJUSTMENTS, COLOR_CHANNELS, HANDLE_SIZE, OVERLAY_PADDING } from './ImageEditor.constants';
import { 
    rgbToHsl, hslToRgb, isPointInRect, getRatioValue, getHandleAtPoint, 
    getCursorForHandle, approximateCubicBezier, getPerspectiveTransform, warpPerspective, hexToRgba,
    createFeatheredMask
} from './ImageEditor.utils';


export const useImageEditorState = (
    imageToEdit: ImageToEdit | null,
    canvasViewRef: React.RefObject<HTMLDivElement>
) => {
    // --- State & Refs ---
    const [internalImageUrl, setInternalImageUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    // History states
    const [history, setHistory] = useState<EditorStateSnapshot[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // Filter states
    const [luminance, setLuminance] = useState(0);
    const [contrast, setContrast] = useState(0);
    const [temp, setTemp] = useState(0);
    const [tint, setTint] = useState(0);
    const [saturation, setSaturation] = useState(0);
    const [vibrance, setVibrance] = useState(0);
    const [hue, setHue] = useState(0);
    const [grain, setGrain] = useState(0);
    const [clarity, setClarity] = useState(0);
    const [dehaze, setDehaze] = useState(0);
    const [blur, setBlur] = useState(0);
    const [rotation, setRotation] = useState(0);
    const [flipHorizontal, setFlipHorizontal] = useState(false);
    const [flipVertical, setFlipVertical] = useState(false);
    const [isInverted, setIsInverted] = useState(false);
    const [colorAdjustments, setColorAdjustments] = useState<ColorAdjustments>(INITIAL_COLOR_ADJUSTMENTS);
    
    // UI states
    const [openSection, setOpenSection] = useState<'adj' | 'hls' | 'effects' | 'magic' | null>('magic');
    const [isGalleryPickerOpen, setIsGalleryPickerOpen] = useState(false);
    const [isWebcamModalOpen, setIsWebcamModalOpen] = useState(false);
    const [activeColorTab, setActiveColorTab] = useState<ColorChannel>(Object.keys(INITIAL_COLOR_ADJUSTMENTS)[0] as ColorChannel);
    const [isShowingOriginal, setIsShowingOriginal] = useState(false);

    // Tool states
    const [activeTool, setActiveTool] = useState<Tool | null>(null);
    const [brushSize, setBrushSize] = useState(20);
    const [brushHardness, setBrushHardness] = useState(50);
    const [brushOpacity, setBrushOpacity] = useState(50);
    const [brushColor, setBrushColor] = useState('#ffffff');
    const [isDrawing, setIsDrawing] = useState(false);
    const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
    const [isCursorOverCanvas, setIsCursorOverCanvas] = useState(false);
    const [aiEditPrompt, setAiEditPrompt] = useState('');

    // Crop-specific states
    const [cropSelection, setCropSelection] = useState<Rect | null>(null);
    const [cropAspectRatio, setCropAspectRatio] = useState('Free');
    const [cropAction, setCropAction] = useState<CropAction | null>(null);
    const [hoveredCropHandle, setHoveredCropHandle] = useState<CropResizeHandle | null>(null);
    const [perspectiveCropPoints, setPerspectiveCropPoints] = useState<Point[]>([]);
    const [hoveredPerspectiveHandleIndex, setHoveredPerspectiveHandleIndex] = useState<number | null>(null);


    // Selection tool states
    const [interactionState, setInteractionState] = useState<Interaction>('none');
    const [selectionStrokes, setSelectionStrokes] = useState<SelectionStroke[]>([]);
    const [isSelectionInverted, setIsSelectionInverted] = useState(false);
    const [penPathPoints, setPenPathPoints] = useState<PenNode[]>([]);
    const [currentPenDrag, setCurrentPenDrag] = useState<{start: Point, current: Point} | null>(null);
    const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
    const [ellipseRect, setEllipseRect] = useState<Rect | null>(null);
    const [featherAmount, setFeatherAmount] = useState(0);

    const panX = useMotionValue(0);
    const panY = useMotionValue(0);
    const scale = useMotionValue(1);
    const [zoomDisplay, setZoomDisplay] = useState(100);
    useMotionValueEvent(scale, "change", (latest) => {
        setZoomDisplay(Math.round(latest * 100));
    });
    const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });
    const [isSpacePanning, setIsSpacePanning] = useState(false);

    // Refs
    const sourceImageRef = useRef<HTMLImageElement | null>(null);
    const originalImageRef = useRef<HTMLImageElement | null>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const tempDrawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const interactionStartRef = useRef<{ mouse: Point; selection?: Rect, handle?: CropResizeHandle | null | number } | null>(null);
    const selectionModifierRef = useRef<'new' | 'add' | 'subtract'>('new');
    const currentDrawingPointsRef = useRef<Point[]>([]);
    const previousToolRef = useRef<Tool | null>(null);
    const lastPointRef = useRef<Point | null>(null);
    const drawAdjustedImageRef = useRef<(() => void) | null>(null);
    const panStartRef = useRef<{ pan: {x: number, y: number}, pointer: Point } | null>(null);

    const isOpen = imageToEdit !== null;

    // --- Memoized Derived State ---
    const selectionPath = useMemo(() => {
        const canvas = previewCanvasRef.current;
        if (!canvas || (selectionStrokes.length === 0 && !isSelectionInverted)) return null;
        const finalPath = new Path2D();
        const addPolygonToPath = (points: Point[], path: Path2D) => {
            if (points.length < 2) return;
            path.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
            if (points.length > 2) path.closePath();
        };
        if (isSelectionInverted) {
            finalPath.rect(0, 0, canvas.width, canvas.height);
            selectionStrokes.forEach(stroke => addPolygonToPath(stroke.op === 'add' ? [...stroke.points].reverse() : stroke.points, finalPath));
        } else {
            selectionStrokes.forEach(stroke => addPolygonToPath(stroke.op === 'subtract' ? [...stroke.points].reverse() : stroke.points, finalPath));
        }
        return finalPath;
    }, [selectionStrokes, isSelectionInverted, canvasDimensions]);

    const isSelectionActive = useMemo(() => selectionPath !== null, [selectionPath]);
    
    // --- Core Functions ---
    const deselect = useCallback(() => {
        setSelectionStrokes([]);
        setIsSelectionInverted(false);
        setPenPathPoints([]);
        setMarqueeRect(null);
        setEllipseRect(null);
    }, []);

    const captureState = useCallback((): EditorStateSnapshot => ({
        luminance, contrast, temp, tint, saturation, vibrance, hue, grain, clarity, dehaze, blur,
        rotation, flipHorizontal, flipVertical, isInverted, colorAdjustments, brushHardness, brushOpacity,
        drawingCanvasDataUrl: drawingCanvasRef.current?.toDataURL('image/png') ?? null,
        imageUrl: internalImageUrl!,
    }), [
        luminance, contrast, temp, tint, saturation, vibrance, hue, grain, clarity, dehaze, blur,
        rotation, flipHorizontal, flipVertical, isInverted, colorAdjustments, brushHardness, brushOpacity, internalImageUrl
    ]);

    const pushHistory = useCallback((newState: EditorStateSnapshot) => {
        const newHistory = history.slice(0, historyIndex + 1);
        const lastState = newHistory[newHistory.length - 1];
        if (lastState && JSON.stringify(lastState) === JSON.stringify(newState)) return;
        newHistory.push(newState);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    }, [history, historyIndex]);

    const restoreState = useCallback((snapshot: EditorStateSnapshot) => {
        setLuminance(snapshot.luminance); setContrast(snapshot.contrast); setTemp(snapshot.temp); setTint(snapshot.tint);
        setSaturation(snapshot.saturation); setVibrance(snapshot.vibrance); setHue(snapshot.hue); setGrain(snapshot.grain);
        setClarity(snapshot.clarity); setDehaze(snapshot.dehaze); setBlur(snapshot.blur); setRotation(snapshot.rotation);
        setFlipHorizontal(snapshot.flipHorizontal); setFlipVertical(snapshot.flipVertical);
        setIsInverted(snapshot.isInverted);
        setBrushHardness(snapshot.brushHardness);
        setBrushOpacity(snapshot.brushOpacity);
        setColorAdjustments(snapshot.colorAdjustments);
        
        if (internalImageUrl !== snapshot.imageUrl) {
            setInternalImageUrl(snapshot.imageUrl);
        }

        const drawingCanvas = drawingCanvasRef.current;
        if (drawingCanvas) {
            const ctx = drawingCanvas.getContext('2d');
            ctx?.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
            if (snapshot.drawingCanvasDataUrl) {
                const img = new Image();
                img.onload = () => ctx?.drawImage(img, 0, 0);
                img.src = snapshot.drawingCanvasDataUrl;
            }
        }
    }, [internalImageUrl, setLuminance, setContrast, setTemp, setTint, setSaturation, setVibrance, setHue, setGrain, setClarity, setDehaze, setBlur, setRotation, setFlipHorizontal, setFlipVertical, setIsInverted, setBrushHardness, setBrushOpacity, setColorAdjustments, setInternalImageUrl]);

    const commitState = useCallback(() => {
        if (!internalImageUrl) return;
        const snapshot = captureState();
        pushHistory(snapshot);
    }, [captureState, pushHistory, internalImageUrl]);

    const resetAll = useCallback((keepImage = false) => {
        // Reset all adjustments and tool states
        setLuminance(0); setContrast(0); setTemp(0); setTint(0); setSaturation(0); setVibrance(0); setHue(0);
        setRotation(0); setFlipHorizontal(false); setFlipVertical(false); setIsInverted(false); setGrain(0); setClarity(0); setDehaze(0); setBlur(0);
        setColorAdjustments(INITIAL_COLOR_ADJUSTMENTS); setActiveColorTab(Object.keys(INITIAL_COLOR_ADJUSTMENTS)[0] as keyof typeof INITIAL_COLOR_ADJUSTMENTS); setOpenSection('magic');
        setActiveTool(null); setBrushSize(20); setBrushHardness(50); setBrushOpacity(50); setBrushColor('#ffffff');
        setCropSelection(null); setCropAspectRatio('Free'); setCropAction(null);
        setPerspectiveCropPoints([]); setHoveredPerspectiveHandleIndex(null);
        deselect(); setInteractionState('none'); setFeatherAmount(0);
        setAiEditPrompt('');
        
        // Clear drawing canvas
        if (drawingCanvasRef.current) {
            const ctx = drawingCanvasRef.current.getContext('2d');
            ctx?.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
        }

        // Logic for handling image and history reset
        if (keepImage) {
            // This case is for the "Reset All" button in the UI.
            // Restore the original image and reset history to its initial state.
            if (originalImageRef.current?.src) {
                const originalUrl = originalImageRef.current.src;
                setInternalImageUrl(originalUrl);

                const initialSnapshot: EditorStateSnapshot = {
                    imageUrl: originalUrl,
                    luminance: 0, contrast: 0, temp: 0, tint: 0, saturation: 0, vibrance: 0, hue: 0,
                    grain: 0, clarity: 0, dehaze: 0, blur: 0, rotation: 0, flipHorizontal: false, flipVertical: false,
                    isInverted: false, brushHardness: 50, brushOpacity: 50, colorAdjustments: INITIAL_COLOR_ADJUSTMENTS,
                    drawingCanvasDataUrl: null,
                };
                setHistory([initialSnapshot]);
                setHistoryIndex(0);
            }
        } else {
            // This case is for when the modal is opened, to clear previous state.
            setInternalImageUrl(null);
            setHistory([]);
            setHistoryIndex(-1);
        }
    }, [deselect]);
    
    const setupNewImage = useCallback((newUrl: string) => {
        resetAll(false);
        setInternalImageUrl(newUrl);

        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = newUrl;
        image.onload = () => {
            originalImageRef.current = image;
        };
        
        const initialSnapshot: EditorStateSnapshot = {
            imageUrl: newUrl,
            luminance: 0, contrast: 0, temp: 0, tint: 0, saturation: 0, vibrance: 0, hue: 0,
            grain: 0, clarity: 0, dehaze: 0, blur: 0, rotation: 0, flipHorizontal: false, flipVertical: false,
            isInverted: false, brushHardness: 50, brushOpacity: 50,
            colorAdjustments: INITIAL_COLOR_ADJUSTMENTS,
            drawingCanvasDataUrl: null,
        };
        setHistory([initialSnapshot]);
        setHistoryIndex(0);
    }, [resetAll]);

    // NEW function to handle a File object directly
    const handleFile = useCallback((file: File) => {
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (typeof reader.result === 'string') {
                    setupNewImage(reader.result);
                }
            };
            reader.readAsDataURL(file);
        }
    }, [setupNewImage]);
    
    // --- Canvas & Drawing Logic ---
    const applyPixelAdjustments = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, options: { ignoreSelection?: boolean } = {}) => {
        const sourceImageData = ctx.getImageData(0, 0, width, height);
        const originalData = new Uint8ClampedArray(sourceImageData.data);
        const data = sourceImageData.data;
    
        // Create a selection mask if a selection is active
        let selectionMask: Uint8ClampedArray | null = null;
        if (!options.ignoreSelection && isSelectionActive && selectionPath) {
            const maskCanvas = createFeatheredMask(selectionPath, width, height, featherAmount);
            const maskCtx = maskCanvas.getContext('2d');
            if (maskCtx) {
                selectionMask = maskCtx.getImageData(0, 0, width, height).data;
            }
        }
    
        const contrastFactor = (100 + contrast) / 100;
        const clarityFactor = clarity / 200;
        const dehazeFactor = dehaze / 100;
        const grainAmount = grain * 2.55;
    
        for (let i = 0; i < data.length; i += 4) {
            const blendFactor = selectionMask ? (selectionMask[i + 3] / 255) : 1;
            
            if (blendFactor < 0.001 && !options.ignoreSelection) {
                continue;
            }
    
            let r = originalData[i], g = originalData[i + 1], b = originalData[i + 2];
            
            if (isInverted) { r = 255 - r; g = 255 - g; b = 255 - b; }
            r = (r - 127.5) * contrastFactor + 127.5; g = (g - 127.5) * contrastFactor + 127.5; b = (b - 127.5) * contrastFactor + 127.5;
            r += temp / 2.5; g += tint / 2.5; b -= temp / 2.5;
            let [h, s, l] = rgbToHsl(r, g, b);
            
            const vibranceAmount = vibrance / 100;
            if (vibranceAmount !== 0) {
                 const max_rgb = Math.max(r, g, b); 
                 const avg_rgb = (r + g + b) / 3;
                 const sat_delta = max_rgb - avg_rgb;
                 // Vibrance should have less effect on saturated colors.
                 // We create a multiplier that is close to 1 for low saturation and close to 0 for high saturation.
                 // sat_delta is a proxy for saturation, ranging roughly from 0 to 170.
                 const vibrance_mult = 1 - (sat_delta / 200); // Normalize roughly to 0-1 range and invert
                 s += (vibranceAmount * 100) * vibrance_mult;
            }

            h = (h + hue) % 360; l += luminance / 2; s += saturation;

            if (clarity !== 0) l += (l - 50) * clarityFactor;
            if (dehaze !== 0) { l = l - (50 - l) * dehazeFactor; s = s + s * (1 - s/100) * dehazeFactor * 0.5; }

            // --- NEW: Smooth HSL color adjustments ---
            let totalHueAdj = 0, totalSatAdj = 0, totalLumAdj = 0;
            // The influence of a color channel extends 60 degrees on either side of its center.
            const HUE_RANGE_WIDTH = 60; 

            for (const channel of COLOR_CHANNELS) {
                const center = channel.center;
                // Calculate the shortest distance on the color wheel (0-360 degrees)
                const dist = Math.min(Math.abs(h - center), 360 - Math.abs(h - center));
                
                // If the hue is within the influence range...
                if (dist < HUE_RANGE_WIDTH) {
                    // Calculate the influence factor (1 at center, 0 at edge)
                    const influence = 1 - (dist / HUE_RANGE_WIDTH);
                    const adj = colorAdjustments[channel.id];
                    
                    // Add the weighted adjustment to the totals
                    totalHueAdj += adj.h * influence;
                    totalSatAdj += adj.s * influence;
                    totalLumAdj += adj.l * influence;
                }
            }
            h += totalHueAdj;
            s += totalSatAdj;
            l += totalLumAdj;

            if (h < 0) h += 360;
            s = Math.max(0, Math.min(100, s)); l = Math.max(0, Math.min(100, l));
            [r, g, b] = hslToRgb(h, s, l);
            if (grain > 0) { const noise = (Math.random() - 0.5) * grainAmount; r += noise; g += noise; b += noise; }
    
            data[i] = originalData[i] * (1 - blendFactor) + r * blendFactor;
            data[i+1] = originalData[i+1] * (1 - blendFactor) + g * blendFactor;
            data[i+2] = originalData[i+2] * (1 - blendFactor) + b * blendFactor;
        }
        ctx.putImageData(sourceImageData, 0, 0);
    }, [luminance, contrast, temp, tint, saturation, vibrance, hue, colorAdjustments, grain, clarity, dehaze, isInverted, isSelectionActive, selectionPath, featherAmount]);

    const drawAdjustedImage = useCallback(() => {
        if (!previewCanvasRef.current) return;
        const canvas = previewCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const image = isShowingOriginal ? originalImageRef.current : sourceImageRef.current;
        
        if (!image || !image.complete || image.naturalWidth === 0) {
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // If showing original, just draw it and return. No transforms/adjustments.
        if (isShowingOriginal) {
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            return;
        }
    
        // --- Draw transformed image without any filters ---
        const isSwapped = rotation === 90 || rotation === 270;
        const drawWidth = isSwapped ? canvas.height : canvas.width;
        const drawHeight = isSwapped ? canvas.width : canvas.height;
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1);
        ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        ctx.restore();
    
        // --- Apply selective HSL/etc adjustments ---
        applyPixelAdjustments(ctx, canvas.width, canvas.height);
    
        // --- Apply selective (or global) blur ---
        if (blur > 0) {
            const unblurredCanvas = document.createElement('canvas');
            unblurredCanvas.width = canvas.width;
            unblurredCanvas.height = canvas.height;
            const unblurredCtx = unblurredCanvas.getContext('2d');
            if (!unblurredCtx) return;
            unblurredCtx.drawImage(canvas, 0, 0); // Capture the state after adjustments
    
            const blurredCanvas = document.createElement('canvas');
            blurredCanvas.width = canvas.width;
            blurredCanvas.height = canvas.height;
            const blurredCtx = blurredCanvas.getContext('2d');
            if (!blurredCtx) return;
    
            blurredCtx.filter = `blur(${blur}px)`;
            blurredCtx.drawImage(unblurredCanvas, 0, 0);
    
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            if (isSelectionActive && selectionPath) {
                // If there's a selection, composite blurred and unblurred versions using a feathered mask.
                const maskCanvas = createFeatheredMask(selectionPath, canvas.width, canvas.height, featherAmount);

                // Start with the unblurred image on the main canvas
                ctx.drawImage(unblurredCanvas, 0, 0);

                // Now, "cut out" the blurred image using the feathered mask
                blurredCtx.globalCompositeOperation = 'destination-in';
                blurredCtx.drawImage(maskCanvas, 0, 0);

                // Finally, draw the masked blurred image on top of the unblurred one.
                ctx.drawImage(blurredCanvas, 0, 0);

            } else {
                // No selection, just draw the fully blurred image.
                ctx.drawImage(blurredCanvas, 0, 0);
            }
        }
    }, [rotation, flipHorizontal, flipVertical, applyPixelAdjustments, blur, isSelectionActive, selectionPath, isShowingOriginal, featherAmount]);

    useEffect(() => {
        if(drawAdjustedImageRef) {
            drawAdjustedImageRef.current = drawAdjustedImage;
        }
    }, [drawAdjustedImage]);
    
    // --- Canvas & Event Handlers ---
    const getPointerInView = (e: React.MouseEvent | React.TouchEvent<HTMLCanvasElement | HTMLDivElement>) => {
        if (!canvasViewRef.current) return null;
        const view = canvasViewRef.current;
        const rect = view.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    };
    
    const getCanvasCoords = useCallback((e: React.MouseEvent | React.TouchEvent<HTMLCanvasElement | HTMLDivElement>) => {
        const viewRect = canvasViewRef.current?.getBoundingClientRect();
        if (!viewRect || canvasDimensions.width === 0) return null;

        const currentScale = scale.get();
        const currentPanX = panX.get();
        const currentPanY = panY.get();
        
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

        const ptr_x_rel_view_center = clientX - (viewRect.left + viewRect.width / 2);
        const ptr_y_rel_view_center = clientY - (viewRect.top + viewRect.height / 2);

        const ptr_x_rel_canvas_center = (ptr_x_rel_view_center - currentPanX) / currentScale;
        const ptr_y_rel_canvas_center = (ptr_y_rel_view_center - currentPanY) / currentScale;
        
        const canvasX = ptr_x_rel_canvas_center + canvasDimensions.width / 2;
        const canvasY = ptr_y_rel_canvas_center + canvasDimensions.height / 2;

        return { x: canvasX, y: canvasY };
    }, [scale, panX, panY, canvasDimensions.width, canvasDimensions.height, canvasViewRef]);
    
    const drawBrushPoint = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number