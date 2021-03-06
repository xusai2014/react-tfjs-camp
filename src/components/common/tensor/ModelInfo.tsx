import React from 'react'
import * as tf from '@tensorflow/tfjs'

interface IProps {
    model?: tf.LayersModel
}

const ModelInfo = (props: IProps): JSX.Element => {
    const { model } = props
    return (
        <>
            <div>
                <h2>Layers</h2>
                {model?.layers.map((l, index) => <div key={index}>{l.name}</div>)}
            </div>
            <div>
                <h2>Weights</h2>
                {model?.weights.map((w, index) => <div key={index}>{w.name}, [{w.shape.join(', ')}]</div>)}
            </div>
        </>
    )
}

export default ModelInfo
