/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useCallback, ChangeEvent, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateReplacedProductImage, editImageWithPrompt } from '../services/geminiService';
import ActionablePolaroidCard from './ActionablePolaroidCard';
import Lightbox from './Lightbox';
import { 
    AppScreenHeader,
    handleFileUpload,
    ImageForZip,
    ResultsView,
    type ReplaceProductInSceneState,
    useLightbox,
    OptionsPanel,
    Slider,
    useVideoGeneration,
    processAndDownloadAll,
    SearchableSelect,
    useAppControls,
    embedJsonInPng,
    Switch,
} from './uiUtils';
import { cn } from '../lib/utils';
import { CheckIcon, CloseIcon, DeleteIcon } from './icons';

interface ReplaceProductInSceneProps {
    mainTitle: string;
    subtitle: string;
    useSmartTitleWrapping: boolean;
    smartTitleWrapWords: number;
    uploaderCaptionProduct: string;
    uploaderDescriptionProduct: string;
    uploaderCaptionScene: string;
    uploaderDescriptionScene: string;
    addImagesToGallery: (images: string[]) => void;
    appState: ReplaceProductInSceneState;
    onStateChange: (newState: ReplaceProductInSceneState) => void;
    onReset: () => void;
    onGoBack: () => void;
    logGeneration: (appId: string, preGenState: any, thumbnailUrl: string) => void;
}

const ReplaceProductInScene: React.FC<ReplaceProductInSceneProps> = (props) => {
    const { 
        uploaderCaptionProduct, uploaderDescriptionProduct,
        uploaderCaptionScene, uploaderDescriptionScene,
        addImagesToGallery,
        appState, onStateChange, onReset,
        logGeneration,
        ...headerProps
    } = props;
    
    const { t, settings } = useAppControls();
    const { lightboxIndex, openLightbox, closeLightbox, navigateLightbox } = useLightbox();
    const { videoTasks, generateVideo } = useVideoGeneration();
    
    const [localProductDescription, setLocalProductDescription] = useState(appState.options.productDescription);
    const [localSceneDescription, setLocalSceneDescription] = useState(appState.options.sceneDescription);
    const [localDecoNotes, setLocalDecoNotes] = useState(appState.options.decoNotes);
    
    useEffect(() => {
        setLocalProductDescription(appState.options.productDescription);
        setLocalSceneDescription(appState.options.sceneDescription);
        setLocalDecoNotes(appState.options.decoNotes);
    }, [appState.options.productDescription, appState.options.sceneDescription, appState.options.decoNotes]);

    const LAYOUT_OPTIONS = t('replaceProductInScene_layoutOptions');
    const SCENE_STYLE_OPTIONS = t('replaceProductInScene_sceneStyleOptions');
    const SCENE_ACTION_OPTIONS = t('replaceProductInScene_sceneActionOptions');
    const PRODUCT_SCALE_OPTIONS = t('replaceProductInScene_productScaleOptions');
    const SHOOTING_STYLE_OPTIONS = t('replaceProductInScene_shootingStyleOptions');
    const PRODUCT_SHADOW_OPTIONS = t('replaceProductInScene_productShadowOptions');
    const ASPECT_RATIO_OPTIONS = t('aspectRatioOptions');

    const lightboxImages = [
        appState.productImage, appState.sceneImage, ...appState.historicalImages,
        appState.decoImage1, appState.decoImage2, appState.decoImage3,
        appState.decoImage4, appState.decoImage5
    ].filter((img): img is string => !!img);

    const handleImageChange = (imageType: keyof ReplaceProductInSceneState) => (newUrl: string) => {
        const newState: Partial<ReplaceProductInSceneState> = { [imageType]: newUrl };
        const updatedState = { ...appState, ...newState };

        if (imageType === 'productImage' || imageType === 'sceneImage') {
            if (updatedState.productImage && updatedState.sceneImage) {
                updatedState.stage = 'configuring';
            } else {
                updatedState.stage = 'idle';
            }
        }
        
        onStateChange(updatedState);
        addImagesToGallery([newUrl]);
    };

    const handleClearImage = (imageType: keyof ReplaceProductInSceneState) => {
        onStateChange({ ...appState, [imageType]: null });
    };
    
    const handleGeneratedImageChange = (newUrl: string) => {
        const newHistorical = [...appState.historicalImages, newUrl];
        onStateChange({ ...appState, stage: 'results', generatedImage: newUrl, historicalImages: newHistorical });
        addImagesToGallery([newUrl]);
    };

    const handleOptionChange = (field: keyof ReplaceProductInSceneState['options'], value: string | boolean) => {
        onStateChange({ ...appState, options: { ...appState.options, [field]: value } });
    };

    const handleReferenceImageChange = (url: string | null) => {
        onStateChange({ ...appState, referenceImage: url });
    };

    const executeGeneration = async () => {
        if (!appState.productImage || !appState.sceneImage) return;
        const preGenState = { ...appState };
        onStateChange({ ...appState, stage: 'generating', error: null });
        try {
            const resultUrl = await generateReplacedProductImage(
                appState.productImage, 
                appState.sceneImage, 
                appState.options,
                [appState.decoImage1, appState.decoImage2, appState.decoImage3, appState.decoImage4, appState.decoImage5],
                appState.referenceImage
            );
            const settingsToEmbed = {
                viewId: 'replace-product-in-scene',
                state: { ...appState, stage: 'configuring', generatedImage: null, historicalImages: [], error: null },
            };
            const urlWithMetadata = await embedJsonInPng(resultUrl, settingsToEmbed, settings.enableImageMetadata);
            logGeneration('replace-product-in-scene', preGenState, urlWithMetadata);
            onStateChange({ ...appState, stage: 'results', generatedImage: urlWithMetadata, historicalImages: [...appState.historicalImages, urlWithMetadata] });
            addImagesToGallery([urlWithMetadata]);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            onStateChange({ ...appState, stage: 'results', error: errorMessage });
        }
    };
    
    const handleRegeneration = async (prompt: string) => {
        if (!appState.generatedImage) return;
        const preGenState = { ...appState };
        onStateChange({ ...appState, stage: 'generating', error: null });
        try {
            const resultUrl = await editImageWithPrompt(appState.generatedImage, prompt);
            const settingsToEmbed = {
                viewId: 'replace-product-in-scene',
                state: { ...appState, stage: 'configuring', generatedImage: null, historicalImages: [], error: null },
            };
            const urlWithMetadata = await embedJsonInPng(resultUrl, settingsToEmbed, settings.enableImageMetadata);
            logGeneration('replace-product-in-scene', preGenState, urlWithMetadata);
            onStateChange({ ...appState, stage: 'results', generatedImage: urlWithMetadata, historicalImages: [...appState.historicalImages, urlWithMetadata] });
            addImagesToGallery([urlWithMetadata]);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            onStateChange({ ...appState, stage: 'results', error: errorMessage });
        }
    };
    
    const handleBackToOptions = () => {
        onStateChange({ ...appState, stage: 'configuring', error: null });
    };

    const handleDownloadAll = () => {
        const inputImages: ImageForZip[] = [];
        if (appState.productImage) inputImages.push({ url: appState.productImage, filename: 'san-pham-goc', folder: 'input' });
        if (appState.sceneImage) inputImages.push({ url: appState.sceneImage, filename: 'boi-canh-goc', folder: 'input' });
        
        processAndDownloadAll({
            inputImages,
            historicalImages: appState.historicalImages,
            videoTasks,
            zipFilename: 'ket-qua-ghep-san-pham.zip',
            baseOutputFilename: 'ket-qua-ghep-san-pham',
        });
    };

    const isLoading = appState.stage === 'generating';

    const Uploader = ({ caption, description, onImageChange, currentImage, placeholderType, cardType }: any) => (
        <div className="flex flex-col items-center gap-4">
            <ActionablePolaroidCard
                type={currentImage ? cardType : 'uploader'}
                caption={caption}
                status="done"
                mediaUrl={currentImage || undefined}
                placeholderType={placeholderType}
                onClick={currentImage ? () => openLightbox(lightboxImages.indexOf(currentImage)) : undefined}
                onImageChange={onImageChange}
            />
            {description && <p className="base-font font-bold text-neutral-300 text-center max-w-xs text-md">{description}</p>}
        </div>
    );

    return (
        <div className="flex flex-col items-center justify-center w-full h-full flex-1 min-h-0">
            <AnimatePresence>
                {(appState.stage === 'idle' || appState.stage === 'configuring') && (<AppScreenHeader {...headerProps} />)}
            </AnimatePresence>

            {appState.stage === 'idle' && (
                <div className="w-full overflow-x-auto pb-4">
                    <motion.div
                        className="flex flex-col md:flex-row items-center md:items-start justify-center gap-6 md:gap-8 w-full md:w-max mx-auto px-4"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                    >
                        <Uploader onImageChange={handleImageChange('productImage')} caption={uploaderCaptionProduct} description={uploaderDescriptionProduct} currentImage={appState.productImage} placeholderType="clothing" cardType="content-input" />
                        <Uploader onImageChange={handleImageChange('sceneImage')} caption={uploaderCaptionScene} description={uploaderDescriptionScene} currentImage={appState.sceneImage} placeholderType="architecture" cardType="style-input" />
                    </motion.div>
                </div>
            )}

            {appState.stage === 'configuring' && appState.productImage && appState.sceneImage && (
                <motion.div className="flex flex-col items-center gap-8 w-full max-w-screen-2xl py-6 overflow-y-auto" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                    <div className="w-full overflow-x-auto pb-4">
                        <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-8 w-full md:w-max mx-auto px-4">
                            <ActionablePolaroidCard type="content-input" mediaUrl={appState.productImage} caption={t('replaceProductInScene_productCaption')} status="done" onClick={() => appState.productImage && openLightbox(lightboxImages.indexOf(appState.productImage))} onImageChange={handleImageChange('productImage')} />
                            <ActionablePolaroidCard type="style-input" mediaUrl={appState.sceneImage} caption={t('replaceProductInScene_sceneCaption')} status="done" onClick={() => appState.sceneImage && openLightbox(lightboxImages.indexOf(appState.sceneImage))} onImageChange={handleImageChange('sceneImage')} />
                        </div>
                    </div>

                    <OptionsPanel className="max-w-4xl">
                        <div className="space-y-6">
                            {/* PRODUCT SECTION */}
                            <div className="space-y-4 p-4 bg-neutral-900/30 rounded-lg border border-white/10">
                                <h3 className="font-bold text-xl text-yellow-300">Sản phẩm</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <SearchableSelect id="layout" label={t('replaceProductInScene_layoutLabel')} options={LAYOUT_OPTIONS} value={appState.options.layout} onChange={(value) => handleOptionChange('layout', value)} />
                                    <SearchableSelect id="shootingStyle" label={t('replaceProductInScene_shootingStyleLabel')} options={SHOOTING_STYLE_OPTIONS} value={appState.options.shootingStyle} onChange={(value) => handleOptionChange('shootingStyle', value)} />
                                </div>
                                <Slider label={t('replaceProductInScene_productScaleLabel')} options={PRODUCT_SCALE_OPTIONS} value={appState.options.productScale} onChange={(value) => handleOptionChange('productScale', value)} />
                                <SearchableSelect id="productShadow" label={t('replaceProductInScene_productShadowLabel')} options={PRODUCT_SHADOW_OPTIONS} value={appState.options.productShadow} onChange={(value) => handleOptionChange('productShadow', value)} />
                                <div>
                                    <label htmlFor="product-description" className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('replaceProductInScene_productDescriptionLabel')}</label>
                                    <textarea id="product-description" value={localProductDescription} onChange={(e) => setLocalProductDescription(e.target.value)} onBlur={() => handleOptionChange('productDescription', localProductDescription)} placeholder={t('replaceProductInScene_productDescriptionPlaceholder')} className="form-input h-20" rows={2} />
                                </div>
                            </div>
    
                            {/* SCENE SECTION */}
                            <div className="space-y-4 p-4 bg-neutral-900/30 rounded-lg border border-white/10">
                                <h3 className="font-bold text-xl text-yellow-300">Bối cảnh</h3>
                                <div>
                                    <label className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('replaceProductInScene_sceneActionLabel')}</label>
                                    <div className="flex gap-4">
                                        {SCENE_ACTION_OPTIONS.map((opt: string) => (
                                            <div key={opt} className="flex items-center">
                                                <input type="radio" id={`action-${opt}`} name="sceneAction" value={opt} checked={appState.options.sceneAction === opt} onChange={(e) => handleOptionChange('sceneAction', e.target.value)} className="h-4 w-4 border-neutral-500 bg-neutral-700 text-yellow-400 focus:ring-yellow-400"/>
                                                <label htmlFor={`action-${opt}`} className="ml-3 block text-sm font-medium text-neutral-300">{opt}</label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="scene-description" className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('replaceProductInScene_sceneDescriptionLabel')}</label>
                                    <textarea id="scene-description" value={localSceneDescription} onChange={(e) => setLocalSceneDescription(e.target.value)} onBlur={() => handleOptionChange('sceneDescription', localSceneDescription)} placeholder={t('replaceProductInScene_sceneDescriptionPlaceholder')} className="form-input h-20" rows={2} />
                                </div>
                                <Slider label={t('replaceProductInScene_sceneStyleLabel')} options={SCENE_STYLE_OPTIONS} value={appState.options.sceneStyle} onChange={(value) => handleOptionChange('sceneStyle', value)} />
                            </div>

                             {/* LIGHTING SECTION */}
                             <div className="space-y-4 p-4 bg-neutral-900/30 rounded-lg border border-white/10">
                                <h3 className="font-bold text-xl text-yellow-300">{t('replaceProductInScene_lightingLabel')}</h3>
                                <div>
                                    <label className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('replaceProductInScene_lightingCategoryLabel')}</label>
                                    <div className="flex flex-wrap gap-4">
                                        {[
                                            { id: 'natural', label: t('replaceProductInScene_naturalLightLabel') },
                                            { id: 'studio', label: t('replaceProductInScene_studioLightLabel') },
                                            { id: 'style', label: t('replaceProductInScene_styleLightLabel') }
                                        ].map(cat => (
                                            <div key={cat.id} className="flex items-center">
                                                <input type="radio" id={`lighting-cat-${cat.id}`} name="lightingCategory" value={cat.id} checked={appState.options.lightingCategory === cat.id} onChange={(e) => handleOptionChange('lightingCategory', e.target.value)} className="h-4 w-4 border-neutral-500 bg-neutral-700 text-yellow-400 focus:ring-yellow-400" />
                                                <label htmlFor={`lighting-cat-${cat.id}`} className="ml-2 block text-sm font-medium text-neutral-300">{cat.label}</label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <AnimatePresence>
                                    {appState.options.lightingCategory === 'natural' && (
                                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                                            <SearchableSelect id="naturalLight" label="" options={t('replaceProductInScene_naturalLightOptions')} value={appState.options.naturalLight} onChange={(v) => handleOptionChange('naturalLight', v)} />
                                        </motion.div>
                                    )}
                                    {appState.options.lightingCategory === 'studio' && (
                                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                                            <SearchableSelect id="studioLight" label="" options={t('replaceProductInScene_studioLightOptions')} value={appState.options.studioLight} onChange={(v) => handleOptionChange('studioLight', v)} />
                                        </motion.div>
                                    )}
                                    {appState.options.lightingCategory === 'style' && (
                                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                                            <SearchableSelect id="styleLight" label="" options={t('replaceProductInScene_styleLightOptions')} value={appState.options.styleLight} onChange={(v) => handleOptionChange('styleLight', v)} />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                                <div className="pt-4 border-t border-white/10">
                                    <div className="flex items-center justify-between mb-2">
                                        <label htmlFor="sync-lighting-toggle" className="block text-left base-font font-bold text-lg text-neutral-200">{t('replaceProductInScene_synchronizeLighting')}</label>
                                        <Switch
                                            id="sync-lighting-toggle"
                                            checked={appState.options.synchronizeLighting}
                                            onChange={(v) => handleOptionChange('synchronizeLighting', v)}
                                        />
                                    </div>
                                    <p className="text-xs text-neutral-500">{t('replaceProductInScene_synchronizeLighting_desc')}</p>
                                </div>
                            </div>
    
                            {/* DECO SECTION */}
                            <div className="space-y-4 p-4 bg-neutral-900/30 rounded-lg border border-white/10">
                                 <h3 className="font-bold text-xl text-yellow-300">Trang trí (Deco) - Nâng cao</h3>
                                <div>
                                    <SearchableSelect id="aspectRatio" label={t('replaceProductInScene_aspectRatioLabel')} options={ASPECT_RATIO_OPTIONS} value={appState.options.aspectRatio} onChange={(v) => handleOptionChange('aspectRatio', v)} />
                                    <label htmlFor="deco-notes" className="block text-left base-font font-bold text-lg text-neutral-200 mt-4 mb-2">Họa tiết deco</label>
                                    <div className="flex gap-2 deco-uploader-container mb-3">
                                        {[1, 2, 3, 4, 5].map(i => {
                                            const decoImageKey = `decoImage${i}` as keyof ReplaceProductInSceneState;
                                            const currentImage = (appState as any)[decoImageKey];
                                            return (
                                                <div key={i} className="w-24 flex flex-col items-center gap-1">
                                                    <ActionablePolaroidCard
                                                        type={currentImage ? 'multi-input' : 'uploader'}
                                                        caption={t('replaceProductInScene_uploaderCaptionDeco', i)}
                                                        status="done"
                                                        mediaUrl={currentImage || undefined}
                                                        placeholderType="style"
                                                        onImageChange={handleImageChange(decoImageKey)}
                                                        onClear={undefined}
                                                    />
                                                    {currentImage && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleClearImage(decoImageKey);
                                                            }}
                                                            className="p-1.5 bg-neutral-800/50 rounded-full text-neutral-400 hover:bg-red-600/80 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors"
                                                            aria-label={`Xóa ${t('replaceProductInScene_uploaderCaptionDeco', i)}`}
                                                        >
                                                            <DeleteIcon className="h-4 w-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <textarea id="deco-notes" value={localDecoNotes} onChange={(e) => setLocalDecoNotes(e.target.value)} onBlur={() => handleOptionChange('decoNotes', localDecoNotes)} placeholder={t('replaceProductInScene_decoNotesPlaceholder')} className="form-input h-20" rows={2} />
                                </div>
                            </div>

                            {/* STYLE REFERENCE SECTION */}
                            {appState.historicalImages.length > 0 && (
                                <div className="space-y-4 p-4 bg-neutral-900/30 rounded-lg border border-white/10">
                                    <h3 className="font-bold text-xl text-yellow-300">Tham chiếu Phong cách (Tùy chọn)</h3>
                                    <p className="text-sm text-neutral-400">Chọn một ảnh đã tạo trước đó để AI sao chép phong cách (ánh sáng, màu sắc, không khí).</p>
                                    <div className="flex flex-wrap gap-2 items-center">
                                        {appState.historicalImages.map(imgUrl => (
                                            <div key={imgUrl} className="relative cursor-pointer group" onClick={() => handleReferenceImageChange(imgUrl)}>
                                                <img src={imgUrl} alt="Ảnh tham chiếu lịch sử" className={`w-20 h-20 object-cover rounded-md transition-all ${appState.referenceImage === imgUrl ? 'ring-4 ring-yellow-400' : 'ring-2 ring-transparent group-hover:ring-yellow-400/50'}`}/>
                                                {appState.referenceImage === imgUrl && (
                                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-md pointer-events-none">
                                                        <CheckIcon className="h-8 w-8 text-yellow-400" />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {appState.referenceImage && <button onClick={() => handleReferenceImageChange(null)} className="p-1.5 rounded-full bg-red-500/80 text-white hover:bg-red-500 transition-colors self-center" aria-label="Bỏ chọn ảnh tham chiếu"><CloseIcon className="h-4 w-4" /></button>}
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        <div className="flex items-center justify-end gap-4 pt-4 border-t border-white/10 mt-4">
                            <button onClick={onReset} className="btn btn-secondary">{t('common_changeImage')}</button>
                            <button onClick={executeGeneration} className="btn btn-primary" disabled={isLoading}>{isLoading ? t('replaceProductInScene_creating') : t('replaceProductInScene_createButton')}</button>
                        </div>
                    </OptionsPanel>
                </motion.div>
            )}
            
            {(appState.stage === 'generating' || appState.stage === 'results') && (
                <ResultsView stage={appState.stage} originalImage={appState.productImage} onOriginalClick={() => appState.productImage && openLightbox(lightboxImages.indexOf(appState.productImage))} error={appState.error} actions={
                    <>
                        {appState.generatedImage && !appState.error && (<button onClick={handleDownloadAll} className="btn btn-secondary">{t('common_downloadAll')}</button>)}
                        <button onClick={handleBackToOptions} className="btn btn-secondary">{t('common_editOptions')}</button>
                        <button onClick={onReset} className="btn btn-secondary">{t('common_startOver')}</button>
                    </>
                }>
                    {appState.sceneImage && (
                        <motion.div key="scene" className="w-full md:w-auto flex-shrink-0" whileHover={{ scale: 1.05, zIndex: 10 }} transition={{ duration: 0.2 }}>
                            <ActionablePolaroidCard type="style-input" caption={t('replaceProductInScene_sceneCaption')} status="done" mediaUrl={appState.sceneImage} onClick={() => appState.sceneImage && openLightbox(lightboxImages.indexOf(appState.sceneImage))} onImageChange={handleImageChange('sceneImage')} />
                        </motion.div>
                    )}
                    <motion.div className="w-full md:w-auto flex-shrink-0" key="generated-replace" initial={{ opacity: 0, scale: 0.5, y: 100 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 80, damping: 15, delay: 0.2 }} whileHover={{ scale: 1.05, zIndex: 10 }}>
                        <ActionablePolaroidCard
                            type="output"
                            caption={t('common_result')}
                            status={isLoading ? 'pending' : (appState.error ? 'error' : 'done')}
                            mediaUrl={appState.generatedImage ?? undefined} error={appState.error ?? undefined}
                            onImageChange={handleGeneratedImageChange}
                            onRegenerate={handleRegeneration}
                            onGenerateVideoFromPrompt={(prompt) => appState.generatedImage && generateVideo(appState.generatedImage, prompt)}
                            regenerationTitle={t('common_regenTitle')}
                            regenerationDescription={t('common_regenDescription')}
                            regenerationPlaceholder={t('replaceProductInScene_regenPlaceholder')}
                            onClick={!appState.error && appState.generatedImage ? () => openLightbox(lightboxImages.indexOf(appState.generatedImage!)) : undefined}
                        />
                    </motion.div>
                    {appState.historicalImages.map(sourceUrl => {
                        const videoTask = videoTasks[sourceUrl];
                        if (!videoTask) return null;
                        return (
                            <motion.div className="w-full md:w-auto flex-shrink-0" key={`${sourceUrl}-video`} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 100, damping: 20 }}>
                                <ActionablePolaroidCard
                                    type="output"
                                    caption={t('common_video')}
                                    status={videoTask.status}
                                    mediaUrl={videoTask.resultUrl}
                                    error={videoTask.error}
                                    onClick={videoTask.resultUrl ? () => openLightbox(lightboxImages.indexOf(videoTask.resultUrl!)) : undefined}
                                />
                            </motion.div>
                        );
                    })}
                </ResultsView>
            )}

            <Lightbox images={lightboxImages} selectedIndex={lightboxIndex} onClose={closeLightbox} onNavigate={navigateLightbox} />
        </div>
    );
};

export default ReplaceProductInScene;