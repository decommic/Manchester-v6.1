/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useCallback, ChangeEvent, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { generatePatternedClothingImage, editImageWithPrompt } from '../services/geminiService';
import ActionablePolaroidCard from './ActionablePolaroidCard';
import Lightbox from './Lightbox';
import { 
    AppScreenHeader,
    handleFileUpload,
    useMediaQuery,
    ImageForZip,
    ResultsView,
    type PatternDesignerState,
    useLightbox,
    OptionsPanel,
    Slider,
    useVideoGeneration,
    processAndDownloadAll,
    SearchableSelect,
    useAppControls,
    embedJsonInPng,
    GalleryPicker,
} from './uiUtils';
import { cn } from '../lib/utils';

interface ColorInputProps {
    id: string;
    placeholder?: string;
    value: string;
    onChange: (newValue: string) => void;
    label?: string;
}

const ColorInput: React.FC<ColorInputProps> = ({ id, placeholder, value, onChange, label }) => {
    const handleColorPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
    };

    const isHexColor = (str: string) => /^#[0-9A-F]{6}$/i.test(str);
    const colorPickerValue = isHexColor(value) ? value : '#ffffff';

    return (
        <div>
            {label && <label htmlFor={id} className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{label}</label>}
            <div className="relative">
                <input
                    type="text"
                    id={id}
                    placeholder={placeholder}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className={cn("form-input w-full !pr-12", !label && "!text-sm")}
                />
                <div className="absolute top-1/2 right-2 -translate-y-1/2 h-7 w-9 rounded-md overflow-hidden border border-neutral-600 bg-neutral-800">
                    <input
                        type="color"
                        value={colorPickerValue}
                        onChange={handleColorPickerChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        title="Chọn màu"
                    />
                    <div
                        className="w-full h-full pointer-events-none"
                        style={{ backgroundColor: isHexColor(value) ? value : 'transparent' }}
                    ></div>
                </div>
            </div>
        </div>
    );
};

interface PatternDesignerProps {
    mainTitle: string;
    subtitle: string;
    useSmartTitleWrapping: boolean;
    smartTitleWrapWords: number;
    uploaderCaptionClothing: string;
    uploaderDescriptionClothing: string;
    uploaderCaptionPattern1: string;
    uploaderDescriptionPattern1: string;
    uploaderCaptionPattern2: string;
    uploaderDescriptionPattern2: string;
    addImagesToGallery: (images: string[]) => void;
    appState: PatternDesignerState;
    onStateChange: (newState: PatternDesignerState) => void;
    onReset: () => void;
    onGoBack: () => void;
    logGeneration: (appId: string, preGenState: any, thumbnailUrl: string) => void;
}

const PatternDesigner: React.FC<PatternDesignerProps> = (props) => {
    const { 
        uploaderCaptionClothing, uploaderDescriptionClothing,
        uploaderCaptionPattern1, uploaderDescriptionPattern1,
        uploaderCaptionPattern2, uploaderDescriptionPattern2,
        addImagesToGallery,
        appState, onStateChange, onReset,
        logGeneration,
        ...headerProps
    } = props;
    
    const { t, settings, imageGallery } = useAppControls();
    const { lightboxIndex, openLightbox, closeLightbox, navigateLightbox } = useLightbox();
    const { videoTasks, generateVideo } = useVideoGeneration();
    const [advancedMode, setAdvancedMode] = useState(false);

    const lightboxImages = [appState.clothingImage, appState.patternImage1, appState.patternImage2, ...appState.historicalImages].filter((img): img is string => !!img);

    const handleImageUpload = (imageType: 'clothingImage' | 'patternImage1' | 'patternImage2') => (e: ChangeEvent<HTMLInputElement>) => {
        handleFileUpload(e, (imageDataUrl) => {
            const newState: Partial<PatternDesignerState> = {
                [imageType]: imageDataUrl,
                generatedImage: null,
                historicalImages: [],
                error: null,
            };
            const updatedState = { ...appState, ...newState };
            if (updatedState.clothingImage && updatedState.patternImage1) {
                updatedState.stage = 'configuring';
            }
            onStateChange(updatedState);
            addImagesToGallery([imageDataUrl]);
        });
    };

    const handleImageChange = (imageType: 'clothingImage' | 'patternImage1' | 'patternImage2') => (newUrl: string) => {
        const newState: Partial<PatternDesignerState> = { [imageType]: newUrl };
        const updatedState = { ...appState, ...newState };
        if (updatedState.clothingImage && updatedState.patternImage1) {
            updatedState.stage = 'configuring';
        } else {
            updatedState.stage = 'idle';
        }
        onStateChange(updatedState);
        addImagesToGallery([newUrl]);
    };
    
    const handleGeneratedImageChange = (newUrl: string) => {
        const newHistorical = [...appState.historicalImages, newUrl];
        onStateChange({ ...appState, stage: 'results', generatedImage: newUrl, historicalImages: newHistorical });
        addImagesToGallery([newUrl]);
    };

    const handleOptionChange = (field: keyof PatternDesignerState['options'], value: any) => {
        onStateChange({ ...appState, options: { ...appState.options, [field]: value } });
    };

    const handleTshirtOptionChange = (field: keyof PatternDesignerState['options']['tshirt'], value: string) => {
        onStateChange({
            ...appState,
            options: {
                ...appState.options,
                tshirt: {
                    ...appState.options.tshirt,
                    [field]: value,
                }
            }
        });
    };

    const executeGeneration = async () => {
        if (!appState.clothingImage || !appState.patternImage1) return;
        const preGenState = { ...appState };
        onStateChange({ ...appState, stage: 'generating', error: null });
        try {
            const resultUrl = await generatePatternedClothingImage(
                appState.clothingImage, 
                appState.patternImage1, 
                appState.options,
                appState.patternImage2
            );
            const settingsToEmbed = {
                viewId: 'pattern-designer',
                state: { ...appState, stage: 'configuring', generatedImage: null, historicalImages: [], error: null },
            };
            const urlWithMetadata = await embedJsonInPng(resultUrl, settingsToEmbed, settings.enableImageMetadata);
            logGeneration('pattern-designer', preGenState, urlWithMetadata);
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
                viewId: 'pattern-designer',
                state: { ...appState, stage: 'configuring', generatedImage: null, historicalImages: [], error: null },
            };
            const urlWithMetadata = await embedJsonInPng(resultUrl, settingsToEmbed, settings.enableImageMetadata);
            logGeneration('pattern-designer', preGenState, urlWithMetadata);
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
        if (appState.clothingImage) inputImages.push({ url: appState.clothingImage, filename: 'trang-phuc-goc', folder: 'input' });
        if (appState.patternImage1) inputImages.push({ url: appState.patternImage1, filename: 'hoa-tiet-1', folder: 'input' });
        if (appState.patternImage2) inputImages.push({ url: appState.patternImage2, filename: 'hoa-tiet-2', folder: 'input' });
        
        processAndDownloadAll({
            inputImages,
            historicalImages: appState.historicalImages,
            videoTasks,
            zipFilename: 'ket-qua-thiet-ke-hoa-tiet.zip',
            baseOutputFilename: 'ket-qua-hoa-tiet',
        });
    };

    const isLoading = appState.stage === 'generating';

    const Uploader = ({ id, onUpload, caption, description, currentImage, onImageChange, placeholderType, cardType }: any) => (
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

            {(appState.stage === 'idle' || appState.stage === 'configuring') && (
                 <motion.div className="flex flex-col items-center gap-8 w-full max-w-screen-2xl py-6 overflow-y-auto" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                    <div className="w-full overflow-x-auto pb-4">
                        <div className="flex flex-col md:flex-row items-center md:items-start justify-center gap-6 md:gap-8 w-full md:w-max mx-auto px-4">
                            <Uploader id="clothing-upload" onUpload={handleImageUpload('clothingImage')} onImageChange={handleImageChange('clothingImage')} caption={uploaderCaptionClothing} description={uploaderDescriptionClothing} currentImage={appState.clothingImage} placeholderType="clothing" cardType="clothing-input" />
                            <Uploader id="pattern1-upload" onUpload={handleImageUpload('patternImage1')} onImageChange={handleImageChange('patternImage1')} caption={uploaderCaptionPattern1} description={uploaderDescriptionPattern1} currentImage={appState.patternImage1} placeholderType="style" cardType="style-input" />
                            <AnimatePresence>
                                {appState.stage === 'configuring' && (
                                    <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                                        <Uploader id="pattern2-upload" onUpload={handleImageUpload('patternImage2')} onImageChange={handleImageChange('patternImage2')} caption={uploaderCaptionPattern2} description={uploaderDescriptionPattern2} currentImage={appState.patternImage2} placeholderType="style" cardType="style-input" />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                    
                    <AnimatePresence>
                        {appState.stage === 'configuring' && (
                             <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.2 } }} exit={{ opacity: 0, y: 20 }} className="w-full max-w-4xl">
                                <OptionsPanel>
                                    <div className="flex justify-center mb-4">
                                        <div className="flex items-center gap-2 bg-neutral-900/50 p-1 rounded-full">
                                            <button onClick={() => setAdvancedMode(false)} className={`px-4 py-1.5 text-sm font-semibold rounded-full transition-colors ${!advancedMode ? 'bg-yellow-400 text-black' : 'text-neutral-300 hover:bg-neutral-700'}`}>{t('patternDesigner_options_basic')}</button>
                                            <button onClick={() => setAdvancedMode(true)} className={`px-4 py-1.5 text-sm font-semibold rounded-full transition-colors ${advancedMode ? 'bg-yellow-400 text-black' : 'text-neutral-300 hover:bg-neutral-700'}`}>{t('patternDesigner_options_advanced')}</button>
                                        </div>
                                    </div>

                                    <AnimatePresence mode="wait">
                                        <motion.div key={advancedMode ? 'advanced' : 'basic'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
                                            {advancedMode ? (
                                                <div className="space-y-4">
                                                     <SearchableSelect id="productType" label={t('patternDesigner_productTypeLabel')} options={t('patternDesigner_productTypeOptions')} value={appState.options.productType} onChange={(v) => handleOptionChange('productType', v)} />
                                                    <AnimatePresence>
                                                        {appState.options.productType.startsWith('Áo') && (
                                                            <motion.div
                                                                initial={{ opacity: 0, height: 0 }}
                                                                animate={{ opacity: 1, height: 'auto' }}
                                                                exit={{ opacity: 0, height: 0 }}
                                                                className="overflow-hidden"
                                                            >
                                                                <div className="p-4 bg-neutral-900/50 rounded-lg space-y-4">
                                                                    <h3 className="font-bold text-yellow-300">{t('patternDesigner_tshirtSectionTitle')}</h3>
                                                                    <div className="grid grid-cols-2 gap-4">
                                                                        <div className="col-span-2"><ColorInput id="tshirt-body-color" label={t('patternDesigner_tshirt_bodyColor')} value={appState.options.tshirt.bodyColor} onChange={v => handleTshirtOptionChange('bodyColor', v)} /></div>
                                                                        <ColorInput id="tshirt-left-sleeve-color" label={t('patternDesigner_tshirt_leftSleeveColor')} value={appState.options.tshirt.leftSleeveColor} onChange={v => handleTshirtOptionChange('leftSleeveColor', v)} />
                                                                        <ColorInput id="tshirt-right-sleeve-color" label={t('patternDesigner_tshirt_rightSleeveColor')} value={appState.options.tshirt.rightSleeveColor} onChange={v => handleTshirtOptionChange('rightSleeveColor', v)} />
                                                                        <ColorInput id="tshirt-collar-color" label={t('patternDesigner_tshirt_collarColor')} value={appState.options.tshirt.collarColor} onChange={v => handleTshirtOptionChange('collarColor', v)} />
                                                                        <ColorInput id="tshirt-hem-color" label={t('patternDesigner_tshirt_hemColor')} value={appState.options.tshirt.hemColor} onChange={v => handleTshirtOptionChange('hemColor', v)} />
                                                                        <SearchableSelect id="printStyle" label={t('patternDesigner_tshirt_printStyle')} options={t('patternDesigner_tshirt_printStyleOptions')} value={appState.options.tshirt.printStyle} onChange={(v) => handleTshirtOptionChange('printStyle', v)} />
                                                                        <Slider
                                                                            label={t('patternDesigner_tshirt_printSizeLabel')}
                                                                            options={t('patternDesigner_patternScaleOptions').slice(0, -1)}
                                                                            value={appState.options.tshirt.printSize}
                                                                            onChange={(v) => handleTshirtOptionChange('printSize', v)}
                                                                        />
                                                                        <div className="col-span-2">
                                                                            <label htmlFor="tshirt-print-notes" className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('patternDesigner_tshirt_printNotesLabel')}</label>
                                                                            <textarea
                                                                                id="tshirt-print-notes"
                                                                                placeholder={t('patternDesigner_tshirt_printNotesPlaceholder')}
                                                                                value={appState.options.tshirt.printNotes}
                                                                                onChange={e => handleTshirtOptionChange('printNotes', e.target.value)}
                                                                                className="form-input !text-sm h-20"
                                                                                rows={2}
                                                                            />
                                                                        </div>
                                                                        <SearchableSelect id="fit" label={t('patternDesigner_tshirt_fit')} options={t('patternDesigner_tshirt_fitOptions')} value={appState.options.tshirt.fit} onChange={(v) => handleTshirtOptionChange('fit', v)} />
                                                                        <SearchableSelect id="fabric" label={t('patternDesigner_tshirt_fabric')} options={t('patternDesigner_tshirt_fabricOptions')} value={appState.options.tshirt.fabric} onChange={(v) => handleTshirtOptionChange('fabric', v)} />
                                                                    </div>
                                                                </div>
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                     <div>
                                                        <label htmlFor="notes-adv" className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('common_additionalNotes')}</label>
                                                        <textarea id="notes-adv" value={appState.options.notes} onChange={(e) => handleOptionChange('notes', e.target.value)} placeholder={t('patternDesigner_notesPlaceholder')} className="form-input h-20" rows={2} />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="space-y-4">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <SearchableSelect id="applicationMode" label={t('patternDesigner_applicationModeLabel')} options={t('patternDesigner_applicationModeOptions')} value={appState.options.applicationMode} onChange={(v) => handleOptionChange('applicationMode', v)} />
                                                        <Slider
                                                            label={t('patternDesigner_patternScaleLabel')}
                                                            options={t('patternDesigner_patternScaleOptions')}
                                                            value={appState.options.patternScale}
                                                            onChange={(v) => handleOptionChange('patternScale', v)}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label htmlFor="aspect-ratio-pattern" className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('common_aspectRatio')}</label>
                                                        <select id="aspect-ratio-pattern" value={appState.options.aspectRatio} onChange={(e) => handleOptionChange('aspectRatio', e.target.value)} className="form-input">
                                                            {t('aspectRatioOptions').map((opt:string) => <option key={opt} value={opt}>{opt}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label htmlFor="color-change-notes" className="block text-left base-font font-bold text-lg text-neutral-200 mb-2">{t('patternDesigner_colorChangeNotesLabel')}</label>
                                                        <textarea
                                                            id="color-change-notes"
                                                            value={appState.options.colorChange.notes}
                                                            onChange={(e) => handleOptionChange('colorChange', {...appState.options.colorChange, notes: e.target.value})}
                                                            placeholder={t('patternDesigner_colorChangeNotesPlaceholder')}
                                                            className="form-input h-20"
                                                            rows={2}
                                                        />
                                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                                                            <ColorInput id="color1" placeholder={t('patternDesigner_colorSwatchLabel', 1)} value={appState.options.colorChange.color1} onChange={v => handleOptionChange('colorChange', {...appState.options.colorChange, color1: v})} />
                                                            <ColorInput id="color2" placeholder={t('patternDesigner_colorSwatchLabel', 2)} value={appState.options.colorChange.color2} onChange={v => handleOptionChange('colorChange', {...appState.options.colorChange, color2: v})} />
                                                            <ColorInput id="color3" placeholder={t('patternDesigner_colorSwatchLabel', 3)} value={appState.options.colorChange.color3} onChange={v => handleOptionChange('colorChange', {...appState.options.colorChange, color3: v})} />
                                                            <ColorInput id="color4" placeholder={t('patternDesigner_colorSwatchLabel', 4)} value={appState.options.colorChange.color4} onChange={v => handleOptionChange('colorChange', {...appState.options.colorChange, color4: v})} />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </motion.div>
                                    </AnimatePresence>
                                    
                                    <div className="flex items-center justify-end gap-4 pt-4 border-t border-white/10">
                                        <button onClick={onReset} className="btn btn-secondary">{t('common_startOver')}</button>
                                        <button onClick={executeGeneration} className="btn btn-primary" disabled={isLoading}>{isLoading ? t('patternDesigner_creating') : t('patternDesigner_createButton')}</button>
                                    </div>
                                </OptionsPanel>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            )}
            
            {(appState.stage === 'generating' || appState.stage === 'results') && (
                <ResultsView stage={appState.stage} originalImage={appState.clothingImage} onOriginalClick={() => appState.clothingImage && openLightbox(lightboxImages.indexOf(appState.clothingImage))} error={appState.error} actions={
                    <>
                        {appState.generatedImage && !appState.error && (<button onClick={handleDownloadAll} className="btn btn-secondary">{t('common_downloadAll')}</button>)}
                        <button onClick={handleBackToOptions} className="btn btn-secondary">{t('common_editOptions')}</button>
                        <button onClick={onReset} className="btn btn-secondary">{t('common_startOver')}</button>
                    </>
                }>
                    <motion.div className="w-full md:w-auto flex-shrink-0" key="generated-pattern" initial={{ opacity: 0, scale: 0.5, y: 100 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 80, damping: 15, delay: 0.2 }}>
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
                            regenerationPlaceholder={t('patternDesigner_regenPlaceholder')}
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

export default PatternDesigner;
