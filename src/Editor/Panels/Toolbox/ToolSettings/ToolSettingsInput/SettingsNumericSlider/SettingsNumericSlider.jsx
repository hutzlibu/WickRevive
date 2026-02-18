import React, { useState } from 'react';
import Popover from 'react-tiny-popover'

import WickInput from 'Editor/Util/WickInput/WickInput';
import ToolIcon from 'Editor/Util/ToolIcon/ToolIcon';

import 'Editor/styles/Panels/Toolbox/settingsnumericslider.css';

import classNames from 'classnames';

export default function SettingsNumericSlider (props) {

  const [sliderOn, setSliderOn] = useState(false);

  return (
    <div className="settings-numeric-slider">
      <ToolIcon
        name={props.icon}
        className={classNames("settings-numeric-slider-icon", {mobile: props.isMobile})}/>

      <Popover
        isOpen={sliderOn}
        position={'bottom'}
        content={<div className="settings-numeric-slider-container">
              <WickInput
                type="slider"
                containerclassname="settings-slider-wick-input-container"
                className="settings-numeric-slider"
                onChange={props.onChange}
                value={props.value}
                {...props.inputRestrictions} />
        </div>}
        onClickOutside={() => {setSliderOn(false)}}
        transitionDuration={100}
        contentDestination={document.getElementById('editor')}
        >
        <WickInput
          type="numeric"
          className={classNames("settings-numeric-input", {"mobile": props.isMobile})}
          onChange={props.onChange}
          onFocus={() => {setSliderOn(true)}}
          onBlur={() => {setSliderOn(false)}}
          onClick={() => {setSliderOn(true)}}
          value={props.value}
          {...props.inputRestrictions}
        />
      </Popover>
    </div>
  )
}
