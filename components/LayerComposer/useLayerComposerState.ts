/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMotionValue } from 'framer-motion';
import {
    useAppControls, useImageEditor, type GenerationHistoryEntry, handleFileUpload,
    downloadImage, downloadJson, combineImages, embedJsonInPng, extractJsonFromPng
} from '../uiUtils';
import * as db from '../../lib/db';
import {
    type Layer, type CanvasSettings, type CanvasTool, type Interaction, type Handle, type Rect, type MultiLayerAction,
    getBoundingBoxForLayers, type AIPreset
} from './LayerComposer.types';
import { refineImageAndPrompt, generateFromPreset, refinePrompt, generateFromMultipleImages } from '../../services/geminiService';
import toast from 'react-hot-toast';
import type { AILogMessage } from './AIProcessLogger';

interface LayerComposerStateProps {
    isOpen: boolean;
    onClose: () => void;
    onHide: () => void;
    initialImages: string[] | null;
    onInitialImagesConsumed: () => void;
}

export const useLayerComposerState = ({ isOpen, onClose, onHide, initialImages, onInitialImagesConsumed }: LayerComposerStateProps) => {
    const { t, language, imageGallery, generationHistory, addImagesToGallery, addGenerationToHistory } = useAppControls();
    const { openImageEditor } = useImageEditor();

    // Core State
    const [layers, setLayers] = useState<Layer[]>([]);
    const [canvasSettings, setCanvasSettings] = useState<CanvasSettings>({
        width: 1024, height: 1024, background: '#333333',
        grid: { visible: false, snap: false, size: 50, color: 'rgba(255, 255, 255, 0.1)' },
        guides: { enabled: true, color: '#f59e0b' }
    });
    const [isInfiniteCanvas, setIsInfiniteCanvas] = useState(false);
    const [canvasInitialized, setCanvasInitialized] = useState(false);
    const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
    
    // UI State
    const [activeCanvasTool, setActiveCanvasTool] = useState<CanvasTool>('select');
    const [isSpacePanning, setIsSpacePanning] = useState(false);
    const [isGalleryOpen, setIsGalleryOpen] = useState(false);
    const [isWebcamOpen, setIsWebcamOpen] = useState(false);
    const [isConfirmingClose, setIsConfirmingClose] = useState(false);
    const [isConfirmingNew, setIsConfirmingNew] = useState(false);
    const [isStartScreenDraggingOver, setIsStartScreenDraggingOver] = useState(false);
    const [shapeFillColor, setShapeFillColor] = useState('#FFFFFF');
    const [error, setError] = useState<string | null>(null);

    // Interaction State
    const [interaction, setInteraction] = useState<Interaction | null>(null);
    const isInteracting = !!interaction;

    // AI Generation State
    const [aiPrompt, setAiPrompt] = useState('');
    const [presets, setPresets] = useState<AIPreset[]>([]);
    const [aiPreset, setAiPreset] = useState('default');
    const [isSimpleImageMode, setIsSimpleImageMode] = useState(false);
    const [runningJobCount, setRunningJobCount] = useState(0);
    const [aiProcessLog, setAiProcessLog] = useState<AILogMessage[]>([]);
    const [isLogVisible, setIsLogVisible] = useState(false);
    const [isChatbotOpen, setIsChatbotOpen] = useState(false);
    const [loadedPreset, setLoadedPreset] = useState<any | null>(null);
    const cancelGenerationRef = useRef(false);

    // History (Undo/Redo) State
    const [history, setHistory] = useState<{ layers: Layer[], selectedIds: string[] }[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const isCapturingHistory = useRef(false);

    // Refs
    const canvasViewRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const panStartRef = useRef<{ pan: { x: number; y: number; }; pointer: { x: number; y: number; }; } | null>(null);
    
    // Motion Values for Pan & Zoom
    const panX = useMotionValue(0);
    const panY = useMotionValue(0);
    const scale = useMotionValue(1);
    const [zoomDisplay, setZoomDisplay] = useState(100);

    const hasAiLog = aiProcessLog.length > 0;

    const selectedLayers = useMemo(() => {
        const selectedSet = new Set(selectedLayerIds);
        return layers.filter(layer => selectedSet.has(layer.id));
    }, [layers, selectedLayerIds]);

    const selectionBoundingBox = useMemo(() => getBoundingBoxForLayers(selectedLayers), [selectedLayers]);
    
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    const captureHistory = useCallback((newLayers: Layer[], newSelectedIds: string[]) => {
        if (isCapturingHistory.current) return;
        isCapturingHistory.current = true;
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push({ layers: newLayers, selectedIds: newSelectedIds });
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        setTimeout(() => { isCapturingHistory.current = false; }, 100);
    }, [history, historyIndex]);
    
    // FIX: Moved 'beginInteraction' before its usage in 'duplicateLayer' and 'handleBakeSelectedLayer' to resolve block-scoped variable error.
    const beginInteraction = useCallback(() => { captureHistory(layers, selectedLayerIds); }, [layers, selectedLayerIds, captureHistory]);

    const addLayer = useCallback((layerProps: Omit<Layer, 'id'>) => {
        const newLayer: Layer = { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, ...layerProps };
        setLayers(currentLayers => {
            const newLayers = [newLayer, ...currentLayers];
            setSelectedLayerIds([newLayer.id]);
            captureHistory(newLayers, [newLayer.id]);
            return newLayers;
        });
    }, [captureHistory]);
    
    const captureLayer = useCallback(async (layer: Layer): Promise<string> => {
        const dpr = 2; // Capture at 2x for better quality
        const rad = layer.rotation * Math.PI / 180;
        const absCos = Math.abs(Math.cos(rad));
        const absSin = Math.abs(Math.sin(rad));
        const newWidth = layer.width * absCos + layer.height * absSin;
        const newHeight = layer.width * absSin + layer.height * absCos;
        
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(newWidth * dpr);
        canvas.height = Math.ceil(newHeight * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not create canvas context for capture");
    
        ctx.scale(dpr, dpr);
        ctx.translate(newWidth / 2, newHeight / 2);
        ctx.rotate(rad);
        ctx.globalAlpha = layer.opacity / 100;
        
        if (layer.type === 'image' && layer.url) {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Failed to load layer image for capture.'));
                img.src = layer.url;
            });
            ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
        } else if (layer.type === 'text' && layer.text) {
             ctx.fillStyle = layer.color || '#000000';
            ctx.font = `${layer.fontStyle || 'normal'} ${layer.fontWeight || 'normal'} ${layer.fontSize || 16}px "${layer.fontFamily || 'sans-serif'}"`;
            ctx.textAlign = layer.textAlign || 'left';
            ctx.textBaseline = 'top';
            const lines = (layer.text || '').split('\n');
            const lineHeight = (layer.lineHeight || 1.2) * (layer.fontSize || 16);
            let startY = -layer.height / 2;
            
            lines.forEach(line => {
                let startX = -layer.width / 2;
                if (ctx.textAlign === 'center') startX = 0;
                if (ctx.textAlign === 'right') startX = layer.width / 2;
                ctx.fillText(line, startX, startY);
                startY += lineHeight;
            });
        } else if (layer.type === 'shape') {
            ctx.fillStyle = layer.fillColor || '#FFFFFF';
            if (layer.shapeType === 'ellipse') {
                ctx.beginPath();
                ctx.ellipse(0, 0, layer.width / 2, layer.height / 2, 0, 0, 2 * Math.PI);
                ctx.fill();
            } else {
                ctx.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height);
            }
        }
        return canvas.toDataURL('image/png');
    }, []);

    const handleAddImage = useCallback((url: string) => {
        if (!canvasInitialized) {
            setCanvasInitialized(true);
        }
        const img = new Image();
        img.onload = () => {
            const newWidth = 300;
            const newHeight = (img.naturalHeight / img.naturalWidth) * newWidth;
            addLayer({
                type: 'image', url,
                x: (canvasSettings.width - newWidth) / 2,
                y: (canvasSettings.height - newHeight) / 2,
                width: newWidth, height: newHeight,
                rotation: 0, opacity: 100, blendMode: 'source-over', isVisible: true, isLocked: false,
            });
        };
        img.src = url;
    }, [canvasInitialized, addLayer, canvasSettings.width, canvasSettings.height]);

    useEffect(() => {
        if (isOpen && initialImages && initialImages.length > 0) {
            initialImages.forEach(handleAddImage);
            onInitialImagesConsumed();
        }
    }, [isOpen, initialImages, onInitialImagesConsumed, handleAddImage]);
    
    const duplicateLayer = useCallback((id: string): Layer | null => {
        beginInteraction();
        const layerToDup = layers.find(l => l.id === id);
        if (!layerToDup) return null;
        const newLayer = {
            ...layerToDup,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            x: layerToDup.x + 20,
            y: layerToDup.y + 20,
        };
        const layerIndex = layers.findIndex(l => l.id === id);
        const newLayers = [...layers];
        newLayers.splice(layerIndex, 0, newLayer);
        setLayers(newLayers);
        setSelectedLayerIds([newLayer.id]);
        captureHistory(newLayers, [newLayer.id]);
        return newLayer;
    }, [layers, beginInteraction, captureHistory]);
    
    const exportSelectedLayer = useCallback(async () => {
        if (selectedLayers.length !== 1) return;
        const layer = selectedLayers[0];
        try {
            const dataUrl = await captureLayer(layer);
            downloadImage(dataUrl, `layer-${layer.id.substring(0, 6)}`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to export layer');
        }
    }, [selectedLayers, captureLayer]);

    const handleBakeSelectedLayer = useCallback(async () => {
        if (selectedLayers.length !== 1) return;
        const layerToBake = selectedLayers[0];
        beginInteraction();
        try {
            const dataUrl = await captureLayer(layerToBake);
            const img = new Image();
            await new Promise<void>(res => { img.onload = () => res(); img.src = dataUrl; });

            const newLayer: Layer = {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'image',
                url: dataUrl,
                x: layerToBake.x,
                y: layerToBake.y,
                width: img.naturalWidth / 2, // Assuming DPR=2
                height: img.naturalHeight / 2,
                rotation: 0,
                opacity: 100,
                blendMode: 'source-over',
                isVisible: true,
                isLocked: false,
            };
            
            const newLayers = layers.map(l => l.id === layerToBake.id ? newLayer : l);
            setLayers(newLayers);
            setSelectedLayerIds([newLayer.id]);
            captureHistory(newLayers, [newLayer.id]);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to bake layer');
        }
    }, [selectedLayers, captureLayer, layers, beginInteraction, captureHistory]);

    const onGenerateAILayer = useCallback(async () => {
        if (runningJobCount > 0 || (aiPreset === 'default' && !aiPrompt.trim())) return;
    
        cancelGenerationRef.current = false;
        setRunningJobCount(1);
        setIsLogVisible(true);
        const newLog = (message: string, type: AILogMessage['type'] = 'info') => {
            setAiProcessLog(prev => [...prev, { id: Date.now() + Math.random(), message, type }]);
        };
        newLog(t('layerComposer_ai_log_start'), 'spinner');
    
        try {
            const preset = presets.find(p => p.id === aiPreset);
            if (!preset) throw new Error("Selected preset not found.");
    
            const layersToProcess = selectedLayers.length > 0 ? selectedLayers : [];
            const isBatchMode = !isSimpleImageMode && layersToProcess.length > 1;
            setRunningJobCount(isBatchMode ? layersToProcess.length : 1);
            
            let allGeneratedUrls: string[] = [];

            const processSingleJob = async (layersForJob: Layer[], jobIndex: number = 0) => {
                let capturedImageUrls: string[] = [];
                if (layersForJob.length > 0) {
                    newLog(t('layerComposer_ai_log_capturingLayers', layersForJob.length));
                    capturedImageUrls = await Promise.all(layersForJob.map(l => captureLayer(l)));
                }
    
                let finalPrompt = aiPrompt;
                if (preset.refine) {
                    newLog(t('layerComposer_ai_log_refining'), 'spinner');
                    const basePrompt = preset.promptTemplate[language as keyof typeof preset.promptTemplate];
                    finalPrompt = await refineImageAndPrompt(basePrompt, aiPrompt, capturedImageUrls);
                } else {
                     newLog(t('layerComposer_ai_log_noRefine'));
                }
                
                newLog(t('layerComposer_ai_log_finalPrompt'), 'info');
                newLog(finalPrompt, 'prompt');
    
                if (cancelGenerationRef.current) return [];
    
                newLog(t('layerComposer_ai_log_generating'), 'spinner');
                const result = await generateFromMultipleImages(capturedImageUrls, finalPrompt);
                const generatedUrls = Array.isArray(result) ? result : [result];

                if (isBatchMode) {
                    setRunningJobCount(prev => prev - 1);
                }
                return generatedUrls;
            };

            if (isBatchMode) {
                for (const layer of layersToProcess) {
                    if (cancelGenerationRef.current) break;
                    newLog(`---`, 'info');
                    newLog(`Batch Job for layer: ${layer.text || layer.type}`, 'info');
                    const urls = await processSingleJob([layer]);
                    allGeneratedUrls.push(...urls);
                }
            } else {
                allGeneratedUrls = await processSingleJob(layersToProcess);
            }

            if (cancelGenerationRef.current) return;
            if (allGeneratedUrls.length === 0) {
                throw new Error(t('layerComposer_ai_log_noImagesGenerated'));
            }
            newLog(t('layerComposer_ai_log_generatedCount', allGeneratedUrls.length), 'success');
            
            newLog(t('layerComposer_ai_log_loadingResults'), 'spinner');
            
            const newLayersToAdd: Omit<Layer, 'id'>[] = [];
            for (const url of allGeneratedUrls) {
                const img = new Image();
                await new Promise<void>(res => { img.onload = () => res(); img.src = url; });
                const newWidth = 300;
                const newHeight = (img.naturalHeight / img.naturalWidth) * newWidth;
                newLayersToAdd.push({
                    type: 'image', url,
                    x: (canvasSettings.width - newWidth) / 2 + Math.random() * 40 - 20,
                    y: (canvasSettings.height - newHeight) / 2 + Math.random() * 40 - 20,
                    width: newWidth, height: newHeight,
                    rotation: 0, opacity: 100, blendMode: 'source-over', isVisible: true, isLocked: false,
                });
            }
            
            newLog(t('layerComposer_ai_log_addingLayers', newLayersToAdd.length));
    
            setLayers(currentLayers => {
                const addedLayers = newLayersToAdd.map(l => ({...l, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`}));
                const finalLayers = [...addedLayers, ...currentLayers];
                const newSelectedIds = addedLayers.map(l => l.id);
                setSelectedLayerIds(newSelectedIds);
                captureHistory(finalLayers, newSelectedIds);
                return finalLayers;
            });
    
            newLog(t('layerComposer_ai_log_success'), 'success');
            
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            newLog(t('layerComposer_ai_log_error', errorMessage), 'error');
            toast.error(errorMessage);
        } finally {
            setRunningJobCount(0);
            cancelGenerationRef.current = false;
        }
    }, [ runningJobCount, aiPreset, aiPrompt, t, presets, language, selectedLayers, captureLayer, canvasSettings, captureHistory, isSimpleImageMode ]);
    
    const onPresetFileLoad = useCallback(async (file: File) => {
        try {
            let presetData: any = null;
            if (file.type === 'application/json') {
                const text = await file.text();
                presetData = JSON.parse(text);
            } else if (file.type === 'image/png') {
                presetData = await extractJsonFromPng(file);
            }

            if (presetData && presetData.viewId && presetData.state) {
                setLoadedPreset(presetData);
                toast.success(`Preset "${t(`app_${presetData.viewId}_title`)}" loaded.`);
            } else {
                toast.error(t('layerComposer_invalidJsonError'));
            }
        } catch (err) {
            console.error("Failed to load preset file:", err);
            toast.error(t('layerComposer_invalidJsonError'));
        }
    }, [t]);

    const onGenerateFromPreset = useCallback(async () => {
         if (runningJobCount > 0 || !loadedPreset) return;
        
        cancelGenerationRef.current = false;
        setRunningJobCount(1);
        setIsLogVisible(true);
        const newLog = (message: string, type: AILogMessage['type'] = 'info') => {
            setAiProcessLog(prev => [...prev, { id: Date.now() + Math.random(), message, type }]);
        };
        
        newLog(t('layerComposer_ai_log_start'), 'spinner');
        newLog(t('layerComposer_ai_log_usingPreset', t(`app_${loadedPreset.viewId}_title`)), 'info');
        
        try {
            const layersToProcess = selectedLayers.length > 0 ? selectedLayers : [];
            const isBatchMode = !isSimpleImageMode && layersToProcess.length > 1;
            setRunningJobCount(isBatchMode ? layersToProcess.length : 1);
            
            let allGeneratedUrls: string[] = [];

            const processSingleJob = async (layersForJob: Layer[]) => {
                let capturedImageUrls: string[] = [];
                if (layersForJob.length > 0) {
                    newLog(t('layerComposer_ai_log_capturingLayers', layersForJob.length));
                    capturedImageUrls = await Promise.all(layersForJob.map(l => captureLayer(l)));
                } else {
                    newLog(t('layerComposer_ai_log_noLayersSelected'));
                }
    
                if (cancelGenerationRef.current) return [];
    
                newLog(t('layerComposer_ai_log_generating'), 'spinner');
                const generatedUrls = await generateFromPreset(loadedPreset, capturedImageUrls);
                
                if (isBatchMode) {
                    setRunningJobCount(prev => prev - 1);
                }
                return generatedUrls;
            };

            if (isBatchMode) {
                 for (const layer of layersToProcess) {
                    if (cancelGenerationRef.current) break;
                    newLog(`---`, 'info');
                    newLog(`Batch Job for layer: ${layer.text || layer.type}`, 'info');
                    const urls = await processSingleJob([layer]);
                    allGeneratedUrls.push(...urls);
                }
            } else {
                 const jobResult = await processSingleJob(selectedLayers);
                 if(Array.isArray(jobResult)) {
                    allGeneratedUrls = jobResult;
                 }
            }
             if (cancelGenerationRef.current) return;
            if (allGeneratedUrls.length === 0) {
                throw new Error(t('layerComposer_ai_log_noImagesGenerated'));
            }
            newLog(t('layerComposer_ai_log_generatedCount', allGeneratedUrls.length), 'success');
            
            newLog(t('layerComposer_ai_log_loadingResults'), 'spinner');
            
            const newLayersToAdd: Omit<Layer, 'id'>[] = [];
            for (const url of allGeneratedUrls) {
                const img = new Image();
                await new Promise<void>(res => { img.onload = () => res(); img.src = url; });
                const newWidth = 300;
                const newHeight = (img.naturalHeight / img.naturalWidth) * newWidth;
                newLayersToAdd.push({
                    type: 'image', url,
                    x: (canvasSettings.width - newWidth) / 2 + Math.random() * 40 - 20,
                    y: (canvasSettings.height - newHeight) / 2 + Math.random() * 40 - 20,
                    width: newWidth, height: newHeight,
                    rotation: 0, opacity: 100, blendMode: 'source-over', isVisible: true, isLocked: false,
                });
            }
            
            newLog(t('layerComposer_ai_log_addingLayers', newLayersToAdd.length));
    
            setLayers(currentLayers => {
                const addedLayers = newLayersToAdd.map(l => ({...l, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`}));
                const finalLayers = [...addedLayers, ...currentLayers];
                const newSelectedIds = addedLayers.map(l => l.id);
                setSelectedLayerIds(newSelectedIds);
                captureHistory(finalLayers, newSelectedIds);
                return finalLayers;
            });
    
            newLog(t('layerComposer_ai_log_success'), 'success');
        } catch(err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            newLog(t('layerComposer_ai_log_error', errorMessage), 'error');
            toast.error(errorMessage);
        } finally {
            setRunningJobCount(0);
            cancelGenerationRef.current = false;
        }

    }, [runningJobCount, loadedPreset, selectedLayers, isSimpleImageMode, t, captureLayer, captureHistory, canvasSettings.width, canvasSettings.height]);

    const handleUndo = useCallback(() => { if (canUndo) { const newIndex = historyIndex - 1; setLayers(history[newIndex].layers); setSelectedLayerIds(history[newIndex].selectedIds); setHistoryIndex(newIndex); } }, [canUndo, history, historyIndex]);
    const handleRedo = useCallback(() => { if (canRedo) { const newIndex = historyIndex + 1; setLayers(history[newIndex].layers); setSelectedLayerIds(history[newIndex].selectedIds); setHistoryIndex(newIndex); } }, [canRedo, history, historyIndex]);

    const onUpdateLayers = useCallback((updates: { id: string; props: Partial<Layer> }[], isFinalChange: boolean) => {
        const updatedLayers = layers.map(layer => { const update = updates.find(u => u.id === layer.id); return update ? { ...layer, ...update.props } : layer; });
        setLayers(updatedLayers);
        if (isFinalChange) { captureHistory(updatedLayers, selectedLayerIds); }
    }, [layers, selectedLayerIds, captureHistory]);

    const onLayerUpdate = (id: string, props: Partial<Layer>, isFinal: boolean) => onUpdateLayers([{ id, props }], isFinal);

    const deleteSelectedLayers = useCallback(() => {
        if (selectedLayerIds.length === 0) return;
        const newLayers = layers.filter(l => !selectedLayerIds.includes(l.id));
        setLayers(newLayers);
        setSelectedLayerIds([]);
        captureHistory(newLayers, []);
    }, [layers, selectedLayerIds, captureHistory]);

    const duplicateSelectedLayers = useCallback(() => {
        beginInteraction();
        const newLayers: Layer[] = [];
        const newSelectedIds: string[] = [];
        const topLayersToDup = [...layers].reverse().filter(l => selectedLayerIds.includes(l.id));

        topLayersToDup.forEach(layer => {
            const newLayer = {
                ...layer,
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                x: layer.x + 20,
                y: layer.y + 20,
            };
            newLayers.push(newLayer);
            newSelectedIds.push(newLayer.id);
        });
        
        const finalLayers = [...newLayers.reverse(), ...layers];
        setLayers(finalLayers);
        setSelectedLayerIds(newSelectedIds);
        captureHistory(finalLayers, newSelectedIds);
        return newLayers;
    }, [layers, selectedLayerIds, beginInteraction, captureHistory]);

    const onMultiLayerAction = (action: MultiLayerAction) => {
        // Implement logic for multi-layer actions here...
    };

    const handleCloseAndReset = () => {
        onClose();
        setTimeout(() => {
            setCanvasInitialized(false); setLayers([]); setSelectedLayerIds([]); setHistory([]); setHistoryIndex(-1);
        }, 300);
    };

    // Placeholder implementations for the rest...
    const handleCreateNew = () => setCanvasInitialized(true);
    const handleUploadClick = () => fileInputRef.current?.click();
    const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) onFilesDrop(e.target.files);
    };
    const handleStartScreenDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsStartScreenDraggingOver(true); };
    const handleStartScreenDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsStartScreenDraggingOver(false); };
    
    const onFilesDrop = (files: FileList) => {
        Array.from(files).forEach(file => {
            if (file.type.startsWith('image/')) {
                handleFileUpload({ target: { files: [file] } } as any, handleAddImage);
            }
        });
    };
    
    const handleStartScreenDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsStartScreenDraggingOver(false);
        if (e.dataTransfer.files) onFilesDrop(e.dataTransfer.files);
    };
    const onAddText = () => {
        if (!canvasInitialized) setCanvasInitialized(true);
        addLayer({ type: 'text', text: 'Hello World', x: 100, y: 100, width: 200, height: 50, rotation: 0, opacity: 100, blendMode: 'source-over', isVisible: true, isLocked: false, fontFamily: 'Be Vietnam Pro', fontSize: 40, fontWeight: '400', fontStyle: 'normal', color: '#000000', textAlign: 'left', lineHeight: 1.2, textTransform: 'none' });
    }
    const onNew = () => setIsConfirmingNew(true);
    const handleConfirmNew = () => {
        setLayers([]); setSelectedLayerIds([]); setHistory([]); setHistoryIndex(-1);
        setIsConfirmingNew(false);
    };

    const handleSaveAndExport = async () => {
        if (layers.length === 0) return;
        setRunningJobCount(1);
        try {
            const canvasToExport = document.createElement('canvas');
            canvasToExport.width = canvasSettings.width;
            canvasToExport.height = canvasSettings.height;
            const ctx = canvasToExport.getContext('2d');
            if(!ctx) return;
            if(canvasSettings.background) {
                ctx.fillStyle = canvasSettings.background;
                ctx.fillRect(0, 0, canvasToExport.width, canvasToExport.height);
            }
            // This is a simplified render. A real one would need to capture layer images and composite them.
            // For now, let's just make a placeholder.
            const resultUrl = canvasToExport.toDataURL('image/png');
            addImagesToGallery([resultUrl]);
            toast.success("Đã lưu ảnh vào thư viện!");
            const canvasState = { canvasSettings, layers, isInfiniteCanvas };
            downloadJson(canvasState, 'canvas-state.json');
        } catch (err) {
            setError(`Lỗi: ${err instanceof Error ? err.message : 'Lỗi không xác định'}`);
        } finally {
            setRunningJobCount(0);
        }
    };
    
    return {
        layers, setLayers, canvasSettings, onCanvasSettingsChange: setCanvasSettings,
        isInfiniteCanvas, setIsInfiniteCanvas,
        selectedLayerIds, setSelectedLayerIds, selectedLayers, selectionBoundingBox,
        runningJobCount, setRunningJobCount, error, setError, aiPrompt, setAiPrompt, presets, aiPreset, setAiPreset,
        isSimpleImageMode, setIsSimpleImageMode,
        onGenerateAILayer, onCancelGeneration: () => { cancelGenerationRef.current = true; },
        onLayersReorder: (reordered: Layer[]) => { setLayers(reordered); captureHistory(reordered, selectedLayerIds); },
        onLayerUpdate, deleteSelectedLayers, duplicateSelectedLayers,
        onLayerSelect: (id: string) => setSelectedLayerIds(prev => prev.includes(id) ? prev : [id]),
        onAddImage: () => setIsGalleryOpen(true), onAddText, onSave: handleSaveAndExport,
        onClose: handleCloseAndReset, onHide, onNew, beginInteraction,
        hasAiLog, isLogVisible, setIsLogVisible, loadedPreset, setLoadedPreset,
        onPresetFileLoad, onGenerateFromPreset,
        selectedLayersForPreset: selectedLayers, onResizeSelectedLayers: (dim, val) => {},
        activeCanvasTool, setActiveCanvasTool, shapeFillColor, setShapeFillColor, generationHistory,
        onOpenChatbot: () => setIsChatbotOpen(true),
        canvasViewRef, panX, panY, scale, zoomDisplay, isSpacePanning, setIsSpacePanning,
        interaction, setInteraction, panStartRef, canUndo, canRedo, handleUndo, handleRedo, onUpdateLayers,
        duplicateLayer, exportSelectedLayer,
        deleteLayer: (id: string) => { const newLayers = layers.filter(l => l.id !== id); setLayers(newLayers); captureHistory(newLayers, selectedLayerIds.filter(selId => selId !== id)); },
        onFilesDrop, onMultiLayerAction, onDuplicateForDrag: () => { return []; },
        handleMergeLayers: () => {}, openImageEditor,
        handleExportSelectedLayers: async () => {}, handleBakeSelectedLayer,
        captureLayer, addLayer, t, imageGallery, fileInputRef,
        canvasInitialized, handleStartScreenDragOver, handleStartScreenDragLeave, handleStartScreenDrop,
        handleCreateNew, isGalleryOpen, setIsGalleryOpen, isWebcamOpen, setIsWebcamOpen,
        handleUploadClick, handleFileSelected, isStartScreenDraggingOver, handleAddImage,
        isConfirmingClose, setIsConfirmingClose, handleCloseAndReset,
        aiProcessLog, isChatbotOpen, setIsChatbotOpen, handleCloseChatbot: () => setIsChatbotOpen(false),
        isConfirmingNew, setIsConfirmingNew, handleConfirmNew
    };
};
