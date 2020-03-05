import React, { useEffect, useReducer, useRef, useState } from 'react'
import * as tf from '@tensorflow/tfjs'
import { Button, Card, Col, message, Row, Select, Tabs } from 'antd'

import {
    arrayDispose,
    ILabeledImage,
    ILabeledImageFileJson,
    ILabeledImageSet, ILabelMap,
    ILayerSelectOption,
    logger,
    STATUS
} from '../../utils'
import { MOBILENET_IMAGE_SIZE } from '../../constant'
import TfvisModelWidget from '../common/tfvis/TfvisModelWidget'
import TfvisLayerWidget from '../common/tfvis/TfvisLayerWidget'
import AIProcessTabs, { AIProcessTabPanes } from '../common/AIProcessTabs'
import ImageUploadWidget from '../common/tensor/ImageUploadWidget'
import MarkdownWidget from '../common/MarkdownWidget'
import LabeledImageSetWidget from '../common/tensor/LabeledImageSetWidget'
import LabeledImageInputSet from '../common/tensor/LabeledImageInputSet'

import { buildObjectDetectionModel } from './modelObjDetector'
import ObjectDetectionImageSynthesizer from './dataObjDetector'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const tfvis = require('@tensorflow/tfjs-vis')

const { TabPane } = Tabs
const { Option } = Select

const MobilenetTransferWidget = (): JSX.Element => {
    /***********************
     * useState
     ***********************/
    const [sTabCurrent, setTabCurrent] = useState<number>(4)

    const [sTfBackend, setTfBackend] = useState<string>()
    const [sStatus, setStatus] = useState<STATUS>(STATUS.INIT)

    const [sOutputClasses, setOutputClasses] = useState<number>(4)
    const [sLearningRate, setLearningRate] = useState<number>(0.0001)
    const [sDenseUnits, setDenseUnits] = useState<number>(100)

    const [sTruncatedModel, setTruncatedModel] = useState<tf.LayersModel>()
    const [sModel, setModel] = useState<tf.LayersModel>()
    const [sLayersOption, setLayersOption] = useState<ILayerSelectOption[]>()
    const [sCurLayer, setCurLayer] = useState<tf.layers.Layer>()

    const [sLabeledImgs, setLabeledImgs] = useState<ILabeledImageSet[]>()
    const [sBatchSize, setBatchSize] = useState<number>(0.4)
    const [sEpochs, setEpochs] = useState<number>(10)

    const [sTrainSet, setTrainSet] = useState<tf.TensorContainerObject>()

    const [sImgUid, genImgUid] = useReducer((x: number) => x + 1, 0)

    const [sLabelsMap, setLabelsMap] = useState<ILabelMap>()
    const [sPredictResult, setPredictResult] = useState<tf.Tensor>()

    const canvasRef = useRef<HTMLCanvasElement>(null)

    /***********************
     * useEffect
     ***********************/

    useEffect(() => {
        logger('init model ...')

        setStatus(STATUS.LOADING)

        tf.backend()
        setTfBackend(tf.getBackend())

        let _model: tf.LayersModel
        buildObjectDetectionModel().then(
            ({ model, fineTuningLayers }) => {
                _model = model
                setModel(model)

                const _layerOptions: ILayerSelectOption[] = _model?.layers.map((l, index) => {
                    return { name: l.name, index }
                })
                setLayersOption(_layerOptions)

                setStatus(STATUS.LOADED)
            },
            (e) => {
                logger(e)
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                message.error(e.message)
            }
        )

        return () => {
            logger('Model Dispose')
            _model?.dispose()
        }
    }, [])

    // useEffect(() => {
    //     logger('init model ...')
    //     if (!sTruncatedModel) {
    //         return
    //     }
    //
    //     setStatus(STATUS.LOADING)
    //
    //     const _model = createModel(sTruncatedModel, sOutputClasses, sLearningRate, sDenseUnits)
    //     setModel(_model)
    //
    //     const _layerOptions: ILayerSelectOption[] = _model?.layers.map((l, index) => {
    //         return { name: l.name, index }
    //     })
    //     setLayersOption(_layerOptions)
    //
    //     setStatus(STATUS.LOADED)
    //
    //     return () => {
    //         logger('Model Dispose')
    //         _model?.dispose()
    //     }
    // }, [sTruncatedModel, sOutputClasses, sLearningRate, sDenseUnits])

    useEffect(() => {
        if (!canvasRef.current) {
            return
        }
        logger('init data set ...')

        // const outputClasses = sLabeledImgs.length
        // setOutputClasses(outputClasses)
        //
        // const labelsArray = sLabeledImgs.map((labeled) => labeled.label)
        // const labelsMap: ILabelMap = {}
        // labelsArray.forEach((item, index) => {
        //     labelsMap[index] = item
        // })
        // setLabelsMap(labelsMap)

        const dataHandler = new ObjectDetectionImageSynthesizer(canvasRef.current)
        // dataHandler.generateExampleBatch(batchSize, numCircles, numLines, triangleProbability)
        // dataHandler.addExamples(sTruncatedModel, sLabeledImgs)
        // setTrainSet(() => dataHandler.getData()) // when use sTrainSet, will get last records

        return () => {
            logger('Data Dispose')
            dataHandler.dispose()
        }
    }, [])

    /***********************
     * Functions
     ***********************/

    const train = (_trainSet: tf.TensorContainerObject): void => {
        logger('train', _trainSet)
        if (!sModel) {
            return
        }

        setStatus(STATUS.TRAINING)

        // We parameterize batch size as a fraction of the entire dataset because the
        // number of examples that are collected depends on how many examples the user
        // collects. This allows us to have a flexible batch size.
        const _tensorX = _trainSet.xs as tf.Tensor
        const _tensorY = _trainSet.ys as tf.Tensor
        const batchSize = Math.floor(_tensorX.shape[0] * sBatchSize)
        if (!(batchSize > 0)) {
            throw new Error('Batch size is 0 or NaN. Please choose a non-zero fraction.')
        }

        const surface = { name: 'Logs', tab: 'Train Logs' }
        // Train the model! Model.fit() will shuffle xs & ys so we don't have to.
        sModel.fit(_tensorX, _tensorY, {
            batchSize,
            epochs: sEpochs,
            callbacks: tfvis.show.fitCallbacks(surface, ['loss', 'acc', 'val_loss', 'val_acc'])
        }).then(
            () => {
                setStatus(STATUS.TRAINED)
            },
            () => {
                // ignore
            })
    }

    const handleTrain = (): void => {
        sTrainSet && train(sTrainSet)
    }

    const handlePredict = (imgTensor: tf.Tensor): void => {
        if (!imgTensor) {
            return
        }
        setStatus(STATUS.PREDICTING)
        // console.log('handlePredict', imgTensor)
        const [imgFeature] = tf.tidy(() => {
            const batched = imgTensor.reshape([1, MOBILENET_IMAGE_SIZE, MOBILENET_IMAGE_SIZE, 3])
            const embeddings = sTruncatedModel?.predict(batched)
            const result = sModel?.predict(embeddings as tf.Tensor) as tf.Tensor
            const imgFeature = result.argMax(-1)
            return [imgFeature]
        })
        logger('Predict', imgFeature)
        setStatus(STATUS.PREDICTED)
        setPredictResult(imgFeature)
    }

    const handleLayerChange = (value: number): void => {
        logger('handleLayerChange', value)
        const _layer = sModel?.getLayer(undefined, value)
        setCurLayer(_layer)
    }

    const handleLabeledImagesSubmit = (value: ILabeledImageFileJson): void => {
        logger('handleLabeledImagesSubmit', value)

        const labeledImageSetList = value.labeledImageSetList
        setLabeledImgs(labeledImageSetList)
    }

    const handleLoadJson = (values: ILabeledImageSet[]): void => {
        sLabeledImgs && arrayDispose(sLabeledImgs)
        setLabeledImgs(values)
    }

    const handleLoadModelWeight = (): void => {
        // TODO : Load saved model
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        message.info('TODO: Not Implemented')
    }

    const handleSaveModelWeight = (): void => {
        // TODO
    }

    const handleTabChange = (current: number): void => {
        setTabCurrent(current)
    }

    /***********************
     * Render
     ***********************/

    const _tensorX = sTrainSet?.xs as tf.Tensor4D
    const _tensorY = sTrainSet?.ys as tf.Tensor

    return (
        <AIProcessTabs title={'Simple Object Detector based Mobilenet'} current={sTabCurrent} onChange={handleTabChange} >
            <TabPane tab='&nbsp;' key={AIProcessTabPanes.INFO}>
                <MarkdownWidget url={'/docs/mobilenet.md'}/>
            </TabPane>
            <TabPane tab='&nbsp;' key={AIProcessTabPanes.DATA}>
                <Row>
                    <Col span={12}>
                        <Card title='Images Label Panel' style={{ margin: '8px' }} size='small'>
                            <LabeledImageInputSet model={sModel} onSave={handleLabeledImagesSubmit} />
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card title='Train Set' style={{ margin: '8px' }} size='small'>
                            <div> XShape: {_tensorX?.shape.join(',')}, YShape: {_tensorY?.shape.join(',')}</div>
                            <LabeledImageSetWidget model={sModel} labeledImgs={sLabeledImgs} onJsonLoad={handleLoadJson}/>
                        </Card>
                    </Col>
                </Row>
            </TabPane>
            <TabPane tab='&nbsp;' key={AIProcessTabPanes.MODEL}>
                <Row>
                    <Col span={12}>
                        <Card title='Model(Expand from Mobilenet)' style={{ margin: '8px' }} size='small'>
                            <TfvisModelWidget model={sModel}/>
                            <p>backend: {sTfBackend}</p>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card title='Model(Expand from Mobilenet)' style={{ margin: '8px' }} size='small'>
                                Select Layer : <Select onChange={handleLayerChange} defaultValue={0}>
                                {sLayersOption?.map((v) => {
                                    return <Option key={v.index} value={v.index}>{v.name}</Option>
                                })}
                            </Select>
                            <TfvisLayerWidget layer={sCurLayer}/>
                        </Card>
                    </Col>
                </Row>
            </TabPane>
            <TabPane tab='&nbsp;' key={AIProcessTabPanes.TRAIN}>
                <Row>
                    <Col span={12}>
                        <Card title='Mobilenet + Simple Object Detect' style={{ margin: '8px' }} size='small'>
                            <LabeledImageSetWidget model={sModel} labeledImgs={sLabeledImgs} onJsonLoad={handleLoadJson}/>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card title='Mobilenet Simple Object Detect Train Set' style={{ margin: '8px' }} size='small'>
                            <div>
                                <Button onClick={handleTrain} type='primary' style={{ width: '30%', margin: '0 10%' }}> Train </Button>
                                <div>status: {sStatus}</div>
                            </div>
                            <div>
                                <Button onClick={handleSaveModelWeight} style={{ width: '30%', margin: '0 10%' }}> Save
                                    Model </Button>
                                <Button onClick={handleLoadModelWeight} style={{ width: '30%', margin: '0 10%' }}> Load
                                    Model </Button>
                                <div>status: {sStatus}</div>
                            </div>
                            <p>backend: {sTfBackend}</p>
                        </Card>
                    </Col>
                </Row>
            </TabPane>
            <TabPane tab='&nbsp;' key={AIProcessTabPanes.PREDICT}>
                <Col span={12}>
                    <Card title='Predict' style={{ margin: '8px' }} size='small'>
                        <ImageUploadWidget model={sModel} onSubmit={handlePredict} prediction={sPredictResult}/>
                    </Card>
                </Col>
            </TabPane>
            <canvas ref={canvasRef} />
        </AIProcessTabs>
    )
}

export default MobilenetTransferWidget
