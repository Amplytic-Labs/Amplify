import React, { useState, useRef, useEffect } from 'react';
import { motion, LayoutGroup } from 'framer-motion';

const transition = { bounce: 0, delay: 0, duration: 0.8, type: 'spring' };
const transformTemplate = (_, t) => `translate(-50%, -50%) ${t}`;

const maskVariants = {
  EuVnQBrQj: {
    mask: 'radial-gradient(50% 50% at 50% 50%, rgb(0, 0, 0) 0%, rgba(0,0,0,0) 0%, rgb(0, 0, 0) 0%, rgba(0, 0, 0, 0) 0%) add',
    WebkitMask:
      'radial-gradient(50% 50% at 50% 50%, rgb(0, 0, 0) 0%, rgba(0,0,0,0) 0%, rgb(0, 0, 0) 0%, rgba(0, 0, 0, 0) 0%) add',
  },
  YRCebAmpq: {
    mask: 'radial-gradient(52% 52% at 50% 50%, rgba(0, 0, 0, 0) 0%, rgb(0, 0, 0) 0.42581644144144143%, rgb(0, 0, 0) 98%, rgba(0,0,0,0) 100%) add',
    WebkitMask:
      'radial-gradient(52% 52% at 50% 50%, rgba(0, 0, 0, 0) 0%, rgb(0, 0, 0) 0.42581644144144143%, rgb(0, 0, 0) 98%, rgba(0,0,0,0) 100%) add',
  },
};

export const Amplify = React.forwardRef((props, ref) => {
  const { variant: propVariant, style, className = '', layoutId, ...rest } = props;
  const fallbackRef = useRef(null);
  const refBinding = ref ?? fallbackRef;
  const [currentVariant, setCurrentVariant] = useState(propVariant === 'Hover' ? 'YRCebAmpq' : 'EuVnQBrQj');

  useEffect(() => {
    if (propVariant) {
      setCurrentVariant(propVariant === 'Hover' ? 'YRCebAmpq' : 'EuVnQBrQj');
    }
  }, [propVariant]);

  const handleMouseEnter = () => {
    if (!propVariant) {
      setCurrentVariant('YRCebAmpq');
    }
  };
  const handleMouseLeave = () => {
    if (!propVariant) {
      setCurrentVariant('EuVnQBrQj');
    }
  };

  return (
    <LayoutGroup id={layoutId}>
      <motion.div
        {...rest}
        ref={refBinding}
        className={`flex flex-col items-center justify-center content-center cursor-pointer flex-nowrap gap-0 overflow-clip p-[2%] relative rounded-[23%] w-full h-full will-change-transform ${className}`}
        style={style}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Dark Mode Layer */}
        <motion.div
          className="flex flex-row items-center justify-center content-center flex-none flex-nowrap gap-0 overflow-visible p-[2%] relative rounded-[23%] bg-[#131415] w-[96%] h-[96%]"
          layoutId="JvH48Y9zm"
        >
          <motion.div
            className="flex flex-col items-center justify-center content-center flex-none flex-nowrap gap-1 h-full w-full overflow-visible p-0 relative"
            layoutId="rOYR8_D6u"
          >
            <svg
              width="84%"
              height="84%"
              viewBox="0 0 1080 1080"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="transition-transform duration-300 transform hover:scale-105"
            >
              <path
                d="M883.298 822H643.396V468.006L500.374 581.424L197 820.746V549.975L332.349 443.244H646.476L882.619 257L883.298 449.095L883.298 822Z"
                fill="rgb(255, 255, 255)"
              />
            </svg>
          </motion.div>
        </motion.div>

        {/* Light Mask Portal Layer */}
        <motion.div
          className="flex flex-row items-center justify-center content-center aspect-square flex-none flex-nowrap gap-0 overflow-visible p-0 absolute left-1/2 top-1/2 z-10 w-[160%] h-[160%]"
          layoutId="BXY0KtMTk"
          style={{ mask: maskVariants.EuVnQBrQj.mask, WebkitMask: maskVariants.EuVnQBrQj.WebkitMask }}
          variants={maskVariants}
          animate={currentVariant}
          transition={transition}
          transformTemplate={transformTemplate}
        >
          <motion.div
            className="flex flex-row items-center justify-center content-center flex-none flex-nowrap gap-0 overflow-visible p-[2%] relative rounded-[23%] bg-[#eaeaea] w-[60%] h-[60%]"
            layoutId="LGJ5vArWO"
          >
            <motion.div
              className="flex flex-col items-center justify-center content-center flex-none flex-nowrap gap-1 h-full w-full overflow-visible p-0 relative"
              layoutId="brbXJZvLa"
            >
              <svg width="84%" height="84%" viewBox="0 0 1080 1080" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M883.298 822H643.396V468.006L500.374 581.424L197 820.746V549.975L332.349 443.244H646.476L882.619 257L883.298 449.095L883.298 822Z"
                  fill="rgb(255, 97, 73)"
                />
              </svg>
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>
    </LayoutGroup>
  );
});

Amplify.displayName = 'Amplify';
export default Amplify;
